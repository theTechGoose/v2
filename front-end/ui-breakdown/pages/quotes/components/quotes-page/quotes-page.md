# QuotesPage

The whole `/quotes` page body: a client-side data island that fetches the
pipeline + win-rate + insight on mount, groups quotes into the three tracks,
and composes the SSR sections + flip cards + sidebar.

## 1. Classification & behavior

- **Bucket:** `island` (`islands/QuotesPage.tsx`).
- **Interaction tier:** `island` — **whole-page client-only island.** The SSR
  route renders an empty shell; this island owns the entire visible body and
  every fetch.
- **Server action + flash:** none. There is no form here, no Fresh route handler
  for the body, no PRG. All reads are client `fetch` via `quotesClient`.
- **Island client-state + refresh:**
  - `s: State = { loading, error, quotes, winRate, insight }` in `useState`,
    seeded `{ loading:true … }`.
  - `lang = langSignal.value` read **during render** → the island re-renders
    when SettingsPage flips the UI language; the `lang` prop is an ignored SSR
    seed (commented as such).
  - `useEffect([lang])`: `Promise.all([list, winRate(90), insight])` (each
    `.catch` → fallback empty/null), then `setS({loading:false, quotes: cards.map(mapCard), …})`.
    Re-fetches whenever `lang` changes. Uses an `alive` guard to drop stale
    resolutions.
- **`location.reload()` FLAG:** not in this file — but its child
  **`DeleteQuoteButton` calls `globalThis.location.reload()`** after a successful
  delete. Because the data lives only in this island's frozen `useState`, a
  delete can't surgically update the list, so the app nukes the whole document.
  See §1 anti-pattern.
- **Data source per region:**
  - quotes → `GET /quotes` (`QuoteCard[]`, engagement-derived).
  - win-rate → `GET /analytics/quotes/win-rate?days=90` (`WinRate`).
  - insight → `GET /analytics/quotes/insight` (`Insight`, feeds QSideTip).
- **Honest-empty:** if `/quotes` returns `[]` (or throws → caught → `[]`), all
  groups are empty; QuotesHero shows its **empty** variant, KPIs read 0 /
  win-rate "—", tracks render with 0 cards (`.qcards` empty), sidebar widgets
  degrade (QSideBig empty list, QSideRate "—", QSideTip default text).
- **Liveness:** none. One fetch on mount (+ refetch on language change). No
  polling, no websocket. A quote opened by a customer won't update without a
  reload.
- **Data-shape hazards:**
  - **Money unit:** `mapCard` copies `c.estimatedTotal` (data-model: **CENTS**)
    straight into `q.value`, and `fmtMoney` expects **cents** — consistent here.
    Contrast ContractsPage, which must `* 100` because its card strings are
    dollars. Don't "fix" one to match the other.
  - **stage vs status:** the island groups by **`stage`** (derived engagement:
    draft/sent/opened/cooling/stale/won/lost), NOT stored `status`. `open` =
    draft+sent+opened+cooling+stale; `out` = those minus draft; `decided` =
    won+lost.
  - **clientCount** counts only quotes with a truthy `customerId` (a `Set`),
    deliberately so two unlinked "—" quotes don't collapse into one phantom
    client (#31).
  - **win-rate fallback math** is defensive and slightly convoluted: if the
    `/win-rate` endpoint is null it recomputes won/lost/decided from the decided
    group; the `lost` fallback expression double-evaluates the won count.
  - `mapCard` hard-codes `band`/`shadow` to the pink ramp for EVERY quote — the
    real per-stage mood color is recomputed inside QuoteCard via
    `moodForQuote(q)`, so these two fields are effectively dead passengers.

### Anti-pattern (page-island + reload)

Per the breakdown brief: QuotesPage is exactly the "whole-page island with
frozen SSR/fetch props + `location.reload()` after mutation" anti-pattern.

- **Frozen data:** fetched once into `useState`; the only refresh paths are a
  language flip or a full reload.
- **Reload after mutate:** `DeleteQuoteButton` → `quotesClient.delete(id)` →
  `location.reload()`. A delete of one decided row reloads the entire SPA,
  re-running every fetch and re-rendering the shell.
- **Fix (rebuild):** Two viable directions —
  1. **Fresh Partial / form+PRG:** make delete a `<form method="POST">` posting
     to a route handler that deletes then redirects back to `/quotes`
     (`303`), rendered through an `f-partial` so only the list swaps — no JS
     reload, flash via the redirect.
  2. **Lift + optimistic island state:** hold `quotes` in a signal owned by
     QuotesPage; DeleteQuoteButton calls a passed-in `onDeleted(id)` that splices
     the array. No document reload. (Callbacks aren't serializable, so in
     isolate they surface as Events, not props.)
- This island also re-fetches all three endpoints on **every** language toggle;
  cheaper would be to re-map the existing `quotes` array client-side.

## 2. Anatomy

```
QuotesPage (Fragment)
├─ loading → <ShimmerStyle/> + <PageHeaderSkeleton/> + <CardGridSkeleton rows=3/>   [shared]
├─ error   → <div class="qpage-error">{loadError}</div>                              [UNSTYLED — hazard]
└─ ready
   ├─ <QuotesHero .../>                       (QuotesSections)
   ├─ <QuotesKpis .../>                        (QuotesSections)
   └─ <div class="qlay">
        ├─ <div> (tracks column)
        │   ├─ QuoteTrack 01 "Out for response"  → .qcards [QuoteCard ×N, sorted]
        │   ├─ QuoteTrack 02 "Drafting"          → .qcards [QuoteCard ×N]
        │   └─ QuoteTrack 03 "Decided this month"→ .qdone  [DecidedRow ×N]
        └─ <aside class="qside">                 (QSideBig, QSideRate, QSideTip)
```

## 3. Props

| name | type | default | control | signal? |
|---|---|---|---|---|
| `lang` | `"en"\|"es"` | `"en"` | select | **ignored SSR seed** — live lang from `langSignal.value` |

No other props. Everything else is fetched.

## 4. States → cases

| state | meaning | case |
|---|---|---|
| loading | initial mount, fetch in flight → skeletons | `cases/loading/loading.json` |
| populated | seed pipeline grouped into 3 tracks + sidebar | `cases/populated/populated.json` |
| empty | `/quotes` → `[]` → empty hero, 0 KPIs, "—" rate | `cases/empty/empty.json` |
| error | a fetch rejected past its `.catch` → `.qpage-error` | `cases/error/error.json` |

> Isolate note: this island self-fetches. The cases drive the **rendered**
> states by mocking `quotesClient.list/winRate/insight` (`_mocks`) rather than
> passing props. `loading` mocks a never-resolving promise; `empty` mocks `[]`;
> `error` mocks a reject on all three.

## 5. Events

- `ev.expect(e => e.source === "header.qtrack__head" && e.type === "click")` →
  bubbles to QuoteTrack [shared] (collapse). Not owned here.
- `ev.expect(e => e.source === "article.qcard" && e.type === "click")` → bubbles
  to QuoteCard flip. Not owned here.
- The "+ New quote" CTA (QuotesHero) is a `type="button"` with **no onClick** —
  a dead stub (see quotes-sections).

## 6. Motion

No motion of its own. Composed motion: QuoteTrack collapse (240ms chevron +
320ms grid-rows), QuoteCard flip (380ms bounce), `.qbar__fill` width (1.2s),
`.qrate` static SVG. Skeleton shimmer is the only thing animating in `loading`.
Reduced-motion handled by the global tokens clamp.

## 7. Responsive

Own breakpoint: `.qlay` collapses `1fr 320px` → `1fr` at **max-width 1200px**
(sidebar drops below the tracks; `.qside` loses `position:sticky`). Child reflow
(`.qph` stack, `.qkpi` 4→2→1, `.qcards` →1col, `.qdone` →1col) handled by
quotes-sections / quote-card / quote-track CSS at 1200/1100/768/560px.

## 8. A11y

- **Error region** `.qpage-error` is a bare div — no `role="alert"`/`aria-live`,
  and (worse) **unstyled** because no CSS rule targets it. Rebuild: real error
  card + `role="alert"`.
- Loading skeletons should expose `aria-busy`/`aria-hidden` (owned by shared
  Skeletons).
- Inherits the QuoteTrack header a11y gap (clickable `<header>`, not a button) —
  flagged in the shared QuoteTrack spec.

## 9. Used on

`/quotes` only. It is the page body for `routes/quotes/index.tsx`. Not reused
elsewhere (the dashboard builds its own `QuoteRow` list from `QuoteCard[]` data,
and does NOT mount this island or the flip QuoteCard).
