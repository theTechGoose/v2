# ClientsPage

The top-level data island for `/clients`. The SSR route renders only the shell
(sidebar + topbar); this island fetches the full payload on mount and composes
the editorial board: hero → loop ribbon → board (with right-rail children) →
an inline Add-Client modal.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/ClientsPage.tsx`).
- **Interaction tier:** `island` (client-only state + on-mount fetch). This is a
  **whole-page island** — the route SSRs nothing of the page body; everything
  below the topbar hydrates and then fetches client-side. So the first paint is
  the skeleton, not content.
- **Client state owned:**
  - `s: State` — `{ loading, error, cards, top, segments }`. Set once by an
    on-mount `Promise.all([list(), top(5), segments()])` (each `.catch`-guarded
    to a benign empty value). `alive` flag guards against setting state after
    unmount.
  - Add-client modal state: `addOpen`, `adding`, `addErr`, and the four field
    signals `addName` / `addBusiness` / `addPhone` / `addEmail`.
- **Data source per region + honest-empty:**
  - `cards` ← `GET /clients` (`CustomerCard[]`). Drives hero counts, loop picks,
    and the board. Empty → hero/board render their honest-empty branches.
  - `top` ← `GET /analytics/clients/top?limit=5`. `segments` ← `GET
    /analytics/clients/segments`. Each independently honest-empty in its section.
- **Server action + flash:** the Add-Client modal does a real mutation —
  `clientsClient.create({ name, businessName?, phoneNumber?, email? })`
  (`POST /customers`). It is **client-side fetch, not a Fresh form/PRG**: on
  success it clears the fields, closes the modal, and calls `refreshClients()`
  (re-fetches `/clients` and merges `cards` into state). On error it sets
  `addErr` (shown inline as a `role="alert"` paragraph). No flash cookie, no
  navigation.
- **Island client-state + refresh — `location.reload()` FLAG:**
  - **No `location.reload()` is used** — refresh after add is a proper
    `refreshClients()` re-fetch + `setS`. Good; do NOT introduce a reload here.
  - **BUT a real frozen-SSR-prop / stale-rollup hazard remains:** `top` and
    `segments` are fetched **once on mount and never refreshed**. After adding a
    client, `refreshClients()` updates only `cards` — the leaderboard and
    segment mix keep their stale on-mount snapshot until a full navigation. A new
    customer with no revenue wouldn't change `top`, but `segments` counts (and
    the hero's editorial copy) can drift. Rebuild fix: have `refreshClients`
    also re-pull `top`+`segments`, or recompute the hero stats from the refreshed
    `cards` (the hero counts ARE derived from `cards`, so those do update; only
    the two analytics rails go stale).
  - `langSignal.value` is read for `lang` (reactive) — the prop `lang` is
    ignored (`{ lang: _lang }`), so the language toggle re-renders correctly.
- **Liveness:** none. Single on-mount fetch; no polling/websocket. Everything
  downstream sees a frozen snapshot until an add or a navigation.
- **Anti-patterns / scrutiny (per task brief):**
  - **Whole-page island:** acceptable here but means no SSR content + a skeleton
    flash on every visit. If the rollup ever moves server-side, prefer SSR-ing
    the first `cards` payload through the route and hydrating from it.
  - **Stale analytics rails after mutation** (above) — the concrete
    frozen-prop bug to flag and fix.
  - **Add-Client modal is 100% inline-styled** with hard-coded hex fallbacks
    (`#144852`, `#6b7560`, `#d8dcd5`, `#a83b3b`) bypassing the token system —
    lift into real classes on rebuild (see `css/clients-page.css`).
- **Data-shape hazards:** inherits data-model.md hazard #3 (`/clients` is N
  per-customer rollups) and #6 (filter/status counts). The three fetches fan out
  three separate whole-account/per-customer aggregate reads on each mount.

## 2. Anatomy
```
ClientsPage (no own wrapper)
├─ loading → <ShimmerStyle/> <PageHeaderSkeleton/> <CardGridSkeleton rows={3}/>   [shared Skeletons]
├─ error   → <div class="cpage-error">{loadError}</div>                            [UNSTYLED — flag]
└─ ready   → <>
     <ClientsHero totalClients activeJobs owedTotal quietCount lang onAdd/>        [ClientsSections]
     <LoopBar picks={pickLoop(cards)} lang/>                                       [ClientsSections]
     <ClientsBoard cards lang>                                                     [ClientsBoard island]
       <TopClients rows={top.results} lang/>                                       [ClientsSections, rail]
       <ClientsSegments rows={segments.segments} lang/>                            [ClientsSections, rail]
     </ClientsBoard>
     {addOpen && <div overlay onClick=close>                                       [INLINE modal]
        <form onSubmit=submitAddClient>
          <h2>Add a client</h2>
          <label>Name <input autoFocus required/></label>
          <label>Business name <input/></label>
          <label>Phone <input type=tel/></label>
          <label>Email <input type=email/></label>
          {addErr && <p role=alert>{addErr}</p>}
          <div actions> <button cancel/> <button submit disabled={!name||adding}>{Add|…}</button> </div>
        </form></div>}
   </>
```
- **Composition (build order):** Skeletons gate → Hero → LoopBar → Board(rail
  children) → modal portal.
- **Derived in island:** `activeJobs = cards.filter(status==="active").length`;
  `owedTotal = Σ(balanceCents>0)/100` (DOLLARS); `quietCount =
  cards.filter(status==="cold").length`; `loopPicks = pickLoop(cards)` (lead/owes,
  sorted by daysSinceContact desc, top 3).

## 3. Props
| name | type | default | widget | signal? |
|---|---|---|---|---|
| `lang` | `"en" \| "es"` | (ignored — reads `langSignal.value`) | select | reads `langSignal` |

The island takes essentially no real props (the route mounts `<ClientsPage />`
with none). `lang` in the signature is dead (`_lang`).

## 4. States → cases
| state | meaning | case |
|---|---|---|
| loading | on-mount skeletons | `cases/loading/loading.json` |
| ready | full board with seed roster | `cases/ready/ready.json` |
| error | fetch threw → `.cpage-error` | `cases/error/error.json` |
| add-modal | Add-Client modal open over the board | `cases/add-modal/add-modal.json` |
| empty | fetch returned `[]` everywhere → empty hero/board | `cases/empty/empty.json` |

Because this island fetches on mount, isolate cases drive the rendered output via
`_signals` (loading/error/addOpen) and `_mocks` (the three client methods) rather
than props.

## 5. Events
- `capture(page)`: `e.source === "button.ph2__cta" && e.type === "click"` →
  `onAdd` → `setAddOpen(true)` (opens modal).
- `capture(page)`: `e.source === "form" (modal) && e.type === "submit"` →
  `submitAddClient` → `POST /customers` → on success refetch `/clients`.
- `capture(page)`: `e.source === "div" (overlay) && e.type === "click"` →
  close modal (unless `adding`).
- `capture(page)`: `e.source === "button" (cancel) && e.type === "click"` →
  close modal.
- Field inputs (`onInput`) update the four add-field signals.

## 6. Motion
- The island contributes no keyframes of its own. The modal appears/disappears by
  conditional mount (no transition in source — it pops in instantly). The visible
  motion all comes from its children (`ClientsSections`/`ClientsBoard` keyframes:
  `ph2-pulse`, `pulse-dot`, panel slide, the dead `ccard2-editorial-in`).
- **Reduced motion:** nothing island-local; relies on the global clamp via the
  children.

## 7. Responsive
- No own `@media`. Layout responsiveness is entirely the children's
  (`.ph2`, `.loopbar`, `.clay2`, `.ccards2` at 1100px / 768px). The inline modal
  uses `padding:20px` on the scrim + `max-width:440px; width:100%` so it's
  fluid on small screens.

## 8. A11y
- Modal error uses `role="alert"` — good.
- **Gaps:** the modal is a plain `<div>`/`<form>`, **not** `role="dialog"` /
  `aria-modal`; no focus trap (only `autoFocus` on the name field); Escape does
  NOT close it (only overlay click / Cancel). Skeleton/error states have no
  `aria-live`. Rebuild: promote the modal to a proper dialog with focus
  management + Escape, and announce load/error.

## 9. Used on
- `/clients` only. Mounted by `routes/clients/index.tsx` as `<ClientsPage />`
  inside `.content`. Sole importer. It in turn owns the only mounts of
  `ClientsBoard` and `ClientsSections`.
