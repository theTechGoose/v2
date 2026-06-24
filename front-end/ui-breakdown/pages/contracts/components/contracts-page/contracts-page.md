# ContractsPage

The top-level data island for `/contracts`. The SSR route ships only the app
shell + a skeleton; this island fetches contracts + customers + quotes on mount,
derives each contract's `mood`, groups the cards into pipeline buckets, and
composes the whole page body (Hero → KPIs → ScheduleStrip → up to 4
ContractTracks of ContractCards).

## 1. Classification & behavior
- **Bucket:** `island` (`islands/ContractsPage.tsx`) — **whole-page island**. It
  is also the page's only composition root: it renders `ContractsHero`,
  `ContractsKpis`, `ScheduleStrip` (page-composition children),
  `ContractTrack` + `ContractCard` (child islands), and the shared `Skeletons`.
- **Per-interaction tier:**
  - The **page body** is `island` (client-only). On mount it fires three GETs
    (`/contracts`, `/clients`, `/quotes`), derives + groups, then **freezes** the
    result in `useState` for the page lifetime.
  - There are **no forms / no PRG / no Fresh Partials** on this page. All
    "actions" are child-`ContractCard` navigations (`location.assign`) to other
    routes; nothing mutates `/contracts` data in place.
- **Island client-state owned + refresh:**
  - `s: State = { loading, error, contracts, customers, quotes }` (`useState`,
    seeded `INITIAL` with `loading:true`). Set **once** in the mount `useEffect`
    `Promise.all([...])`; an `alive` flag guards against setState-after-unmount.
  - **No refresh path:** there is no re-fetch, no interval, no subscription, no
    refetch-on-focus. The data is fetched exactly once per mount and held.
- **Server action + flash:** none here (no mutation on this page).
- **`location.reload()` flag — FROZEN-SSR / single-fetch anti-pattern:**
  - This page has **no `location.reload()`** of its own (unlike `/quotes`, which
    reloads after a delete). The page-level note in `contracts.md` confirms it's
    *less* exposed than /quotes. **However** the frozen-single-fetch pattern is
    the real smell: the island fetches once and freezes; any data change made
    elsewhere (e.g. the card CTAs that `location.assign('/invoices')` to confirm a
    payment, then the contractor navigates back) is **invisible until a full page
    reload** because the browser re-mounts the island only on hard nav. The child
    `ContractCard` CTAs *are* full navigations, so coming back to `/contracts`
    does re-mount and re-fetch — the freeze is masked by the fact that every exit
    is a hard nav. If those CTAs were ever switched to SPA/Partial routing, stale
    contract moods would surface.
  - **The form+PRG / Partial fix (for the rebuild):** the contracts list +
    derived moods should be **server-rendered** (SSR the route with the contract
    data, derive mood server-side — the backend already does `deriveMood`), and
    any mutation (confirm payment, send invoice) should be a **form → POST →
    303 PRG redirect back to `/contracts`** so the freshly-derived list re-renders
    server-side, OR a **Fresh Partial** (`f-client-nav` + a `<Partial>` wrapping
    the tracks) that re-renders just the tracks after the action without a
    whole-island remount or a `reload()`. Either removes the "fetch-once-and-pray"
    client island entirely. The skeleton-then-fetch flash (the page shows
    `PageHeaderSkeleton` + `CardGridSkeleton rows={3}` on every cold mount because
    **nothing is SSR'd for the body**) also disappears once the body is SSR'd.
- **Data source per region:**
  - `/contracts` → `contractsClient.list()` → `Contract[]` (each with server-
    derived `mood`). `.catch(() => [])` — 404/error-safe to empty.
  - `/clients` → `clientsClient.list()` → `CustomerCard[]` (used **only** to build
    a `customerId → name` map; the rollup fields are ignored here). `.catch([])`.
  - `/quotes` → `quotesClient.list()` → `QuoteCard[]` (used **only** to build a
    `quoteId → jobName||summary` map for card titles). `.catch([])`.
  - These run via `Promise.all` (parallel). The whole island consumes
    `clients/contracts.ts`, `clients/clients.ts`, `clients/quotes.ts` — NOT
    `ssrBackendGet` (no SSR data for the body; see contracts.md "SSR data: None").
  - Each raw `Contract` → `lib/contracts-shape.ts` `toContractCard({contract,
    customerNames, quoteSummaries, now, index})` → the rich `ContractCard` the
    children consume.
- **Honest-empty:**
  - Each track shows a `.kempty` slate when its mood bucket is empty (Tracks
    01–03). **Track 04 Drafts is omitted entirely** when `drafts.length === 0` (no
    element, no slate).
  - Hero shows its `allZero` empty line; ScheduleStrip shows `.csched__empty` when
    no bars fall in range. A fully-empty account therefore renders the hero +
    4 zero-KPIs + empty schedule + three empty-slate tracks — coherent, not blank.
  - **Defensive `Array.isArray(...)` guards** re-wrap each fetched list (in case a
    client returns a non-array) before grouping.
- **Liveness:** request-response, **once** per mount. No polling, no websocket.
  (Cosmetic pulses live in the children, not here.)
- **Reactivity / i18n:** reads `langSignal.value` at render → re-localizes the
  whole page (titles, track counts via a local `plural()` helper, child labels)
  when Settings flips language; the underlying data is not re-fetched on flip.
- **Data-shape hazards:**
  - **Mood grouping over an unpaginated list (THE flagged data-shape hazard).**
    `contracts.map(toContractCard)` then five `.filter(c.mood === …)` passes run
    over the **entire** `/contracts` response with **no pagination** — the
    client-side face of data-model §5.9 ("Contract list `mood` … full-list read
    with no pagination"). At demo scale (handful of contracts) it's free; with
    hundreds of contracts the island fetches + derives + 5×-filters the whole set
    on the client every mount. **Mitigation:** paginate or pre-bucket server-side
    (the backend already derives `mood`; have it return mood-bucketed counts +
    paged lists per bucket).
  - **`active` is the catch-all fallback mood.** `toContractCard` defaults
    `mood = contract.mood ?? "active"` — a contract with a missing/unknown server
    mood silently lands in "In progress" (Track 01). Could over-count active.
  - **`liveCards = active + starting-soon + wrapping-up`** drives the hero total
    and the schedule strip — `completed` and `draft`/`stale` are **excluded** from
    the headline "$ committed" figure by design.
  - **Money 100×-low guard.** Card money fields are dollar strings; the island
    re-parses them to **cents** (`Math.round(parseMoney(c[key]) * 100)`) before
    handing to `fmtMoney`-consuming sections — the explicit fix for the
    "$10 of a $1,000 contract" bug. Do not pass dollars to the sections.
  - **`parseMoney` strips all non-`[0-9.]`** — fine for "$1,000.00" but a string
    with two dots or thousands-dots in es-locale formatting could misparse;
    upstream `fmtMoney` controls the format so it's currently safe.

## 2. Anatomy
```
ContractsPage (island)
├─ loading → <><ShimmerStyle/><PageHeaderSkeleton/><CardGridSkeleton rows={3}/></>   ← shared Skeletons
├─ error   → <div class="kpage-error">{loadError}: {msg}</div>                        ← UNSTYLED class (hazard, see §6/css)
└─ ready   → <>
     <ContractsHero …/>                          ← page-composition
     <ContractsKpis …/>                           ← page-composition
     <ScheduleStrip cards={liveCards} …/>         ← page-composition
     <ContractTrack num="01" In progress …>       ← child island
        {inProgress.length ? <div class="kcards">{inProgress.map(ContractCard)}</div> : <div class="kempty"/>}
     <ContractTrack num="02" Starting soon … defaultOpen={false}>  … </ContractTrack>
     <ContractTrack num="03" Wrapping up … defaultOpen={false}>    … </ContractTrack>
     {drafts.length > 0 &&
       <ContractTrack num="04" Drafts … defaultOpen={false}>
          <div class="kcards">{drafts.map(ContractCard)}</div>     ← no empty slate (only rendered if >0)
       </ContractTrack>}
   </>
```
- **Grouping:** `inProgress=mood active`, `startingSoon=starting-soon`,
  `wrappingUp=wrapping-up`, `closed=completed`, `drafts=draft||stale`.
  `liveCards = inProgress + startingSoon + wrappingUp`.
- **Dependency (not a UI component):** `lib/contracts-shape.ts`
  (`toContractCard`, `moodFor`) — the projection every child consumes.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `lang` | `Lang` (`"en"\|"es"`) | (reads `langSignal.value`) | select | yes (`langSignal`) |

> The only prop is the optional `lang`; in practice the island reads
> `langSignal.value` directly, so `lang` is effectively signal-driven. All page
> data is fetched, not passed — so isolate cases drive the **fetched data** via
> `_mocks` (the three clients) + `_signals` for the language, not via props.

## 4. States → cases
| state | meaning | case |
|---|---|---|
| loading | mount before fetch resolves → Skeletons | `cases/loading/loading.json` |
| error | a fetch rejects (not caught to []) → `.kpage-error` | `cases/error/error.json` |
| populated | full board: hero + KPIs + strip + tracks 01–04 | `cases/populated/populated.json` |
| empty | fetch resolves to []/[]/[] → zero hero + empty slates, no Track 04 | `cases/empty/empty.json` |
| es | Spanish — whole page re-localized | `cases/es/es.json` |

## 5. Events
The island owns no direct DOM events (no buttons of its own). Its observable
behavior is the **mount fetch** and the resulting render; child events live in
their own specs. Capture the lifecycle as:
- `ev.expect(e => e.source === "island#ContractsPage" && e.type === "mount")` →
  fires `Promise.all([contracts.list, clients.list, quotes.list])`; on resolve
  sets `{loading:false, contracts, customers, quotes}`; on reject sets `error`.
- (Child events — track collapse, card flip, card CTA navigation — are specified
  in `contract-track/`, `contract-card/`.)

## 6. Motion (extracted)
- **The island itself has no motion** — its CSS (`contracts-page.css`) styles only
  the `.kpage-error` text and documents the loading state. All visible motion
  belongs to the children: skeleton shimmer (shared `Skeletons`/`ShimmerStyle`),
  hero pulse + CTA hover + schedule hover (contracts-sections), track collapse
  (contract-track), card flip/hover/prog-fill (contract-card).
- **`.kpage-error` HAZARD (real, flagged in css):** the error branch renders
  `<div class="kpage-error">` but **that class has no rule in `static/contracts.css`
  or `static/dashboard.css`** — the error message renders as unstyled body text. A
  minimal rule is reproduced in `css/contracts-page.css` for isolate legibility
  only; the rebuild should add a real error-card style.
- **Loading→ready transition:** there is no crossfade — skeletons are swapped for
  content in one render (a hard pop). Rebuild could fade, but it's not jank.
- **Reduced motion:** N/A at this level (no own animation); the children carry
  the (global-clamp-only) reduced-motion behavior.

## 7. Responsive
- **No own `@media` queries.** `contracts-page.css` only styles the error text +
  documents loading. The page body is a **single stacked column** (NO two-column
  `.qlay` layout, unlike /quotes — see contracts.md). All responsiveness comes
  from the children's CSS (contracts-sections @1100/700px; the `.kcards` auto-fill
  grid). Verify the whole stack at 1280 / 1100 / 700px on the live route.

## 8. A11y
- **Loading state** is a visual skeleton with no `aria-busy`/live-region
  announcement — a screen reader hears nothing while the page is empty then
  suddenly hears the full board. **Rebuild:** add `aria-busy` / a polite
  live-region status, or (better) SSR the body so there is no empty phase.
- **Error state** is unstyled, unlabeled text (`.kpage-error`) — add `role="alert"`
  + a real error card so failures are announced and visible.
- Heading order: the page emits `ContractsHero`'s `<h1>` then each track's `<h2>`
  then each card's `<h3>` — a sane outline (good), provided the sections render in
  source order (they do).
- All deeper a11y (track keyboard operability, card flip focus) is owned by the
  child specs.

## 9. Used on
**Only** `routes/contracts/index.tsx` (`/contracts`), as the single page-local
island inside the app shell (`DashSidebar` + `DashTopbar` + `<div class="content">`
— see contracts.md). Evidence: grep of `ContractsPage` import. It consumes
`clients/contracts.ts`, `clients/clients.ts`, `clients/quotes.ts`,
`lib/contracts-shape.ts`, the shared `Skeletons`, and mounts `ContractsHero` /
`ContractsKpis` / `ScheduleStrip` / `ContractTrack` / `ContractCard`. CSS:
`css/contracts-page.css` (error/loading only — all visible chrome is the children).
