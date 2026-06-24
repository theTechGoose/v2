# ContractTrack

Collapsible "track" group (numbered section header + count + collapsible body)
that groups the contracts pipeline into stacked bands (In progress / Starting
soon / Wrapping up / Drafts) on `/contracts`. The contracts-specific twin of the
shared `QuoteTrack` — same collapse mechanic, **separate component** with a
narrower prop surface.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/ContractTrack.tsx`).
- **Interaction tier:** `island` (client-only state) — a controlled disclosure.
- **Client state owned + refresh:**
  - `open: boolean` — section expanded/collapsed. Seeded lazily from
    `localStorage[storageKey]` (`"1"`/`"0"`) when a `storageKey` is given, else
    `defaultOpen`. Written back to that key in a `useEffect` on every change (so
    a contractor's per-track open/closed preference survives reloads). No data
    refresh — the body content is frozen props passed by the parent.
- **Server action + flash:** none. This is a pure layout/disclosure shell; it
  performs no mutations and renders no flash.
- **`location.reload()` flag:** none — state is local + `localStorage`-persisted.
  No reload, no PRG, no Partial needed. (Note: `count` and `children` are frozen
  props — if the parent `ContractsPage` re-fetches, it must re-render
  ContractTrack with a new `count` string and new children; ContractTrack never
  fetches on its own.)
- **Data source per region:** none of its own. `num`, `title`, `count` are
  **props** supplied by the parent page island (`ContractsPage`), which has
  already pre-formatted `count` into a localized string
  (`plural("contractsPage.inProgress.count", n)`). The body comes via `children`.
  No `clients/contracts.ts` or `ssrBackendGet` call here — the parent owns the
  fetch (see `contracts-page/`).
- **Honest-empty:** ContractTrack does **not** own an empty state. The parent
  passes either a `.kcards` grid of `ContractCard`s **or** a `.kempty` slate as
  `children`; the count label (e.g. "0 contracts") always renders from the prop.
  (Track 04 Drafts is the exception — the parent omits the whole `<ContractTrack>`
  element when `drafts.length === 0`, so no empty slate ever shows for drafts.)
- **Liveness:** none (request-response via parent). No polling/websocket.
- **Reactivity / i18n:** **no `lang` prop** (unlike QuoteTrack). `count` arrives
  pre-localized as a string; `title` arrives pre-translated. The component does
  not call `tFor` — it re-localizes only when the parent re-renders it.
- **Data-shape hazards:**
  - `count` is a **frozen pre-formatted string** ("3 contracts"), not a
    `number`+`unit` pair. ContractTrack cannot re-pluralize; if the parent passes
    a stale string the count desyncs from the body. (QuoteTrack takes a `number`
    and localizes itself — this twin pushed that responsibility up to the parent.)
  - `storageKey` collisions: the parent must pass distinct keys per track
    (`contracts:track:01`…`04`). Reusing a key across tracks would share
    open-state. Reusing the `pm:qtrack:*` keys would collide with QuoteTrack.

## 2. Anatomy
```
<section class="ktrack [ktrack--collapsed]">
  <header class="ktrack__head" onClick=toggle>
    <span class="ktrack__chev"><I chev size=14 sw=2.5/></span>   ← rotate(90deg) open / rotate(0deg) collapsed
    <span class="ktrack__num">{num}</span>                       ← e.g. "01" (pink, tracking-wide)
    <h2 class="ktrack__title">{title}</h2>                       ← e.g. "In progress" (QuoteTrack uses a <span>)
    <span class="ktrack__count">{count}</span>                   ← pre-formatted string, margin-left:auto
  </header>
  <div class="ktrack__body">
    <div class="ktrack__body-inner">{children}</div>             ← .kcards grid OR .kempty slate
  </div>
</section>
```
- **Slots/children:** yes — `children` render inside `.ktrack__body-inner` (the
  parent passes the track's cards/empty slate here).
- **Icon dependency:** `I` + `ICN.chev` from `lib/dash-icons.tsx` (copied to
  `js/dash-icons.tsx`).

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `num` | string (required) | — | text | no |
| `title` | string (required) | — | text | no |
| `count` | string (required, pre-formatted) | — | text | no |
| `defaultOpen` | boolean | `true` | boolean | no |
| `storageKey` | string | `undefined` (no persistence) | text | no |
| `children` | ComponentChildren | — | (slot) | no |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| open | expanded body (`defaultOpen=true`, Track 01) | `cases/open/open.json` |
| collapsed | `ktrack--collapsed`, body rows 0fr (Track 02) | `cases/collapsed/collapsed.json` |
| empty | `count="0 contracts"` + `.kempty` slate as children | `cases/empty/empty.json` |
| drafts | Track 04 "Drafts" wording, collapsed | `cases/drafts/drafts.json` |

## 5. Events
- `ev.expect(e => e.source === "header.ktrack__head" && e.type === "click")` →
  toggles `open`; the `useEffect` writes `localStorage[storageKey]` (`"1"`/`"0"`)
  when `storageKey` is set.

## 6. Motion (extracted from contract-track.css)
- **Chevron:** `.ktrack__chev` is `transform: rotate(90deg)` open (points down);
  `.ktrack--collapsed .ktrack__chev` is `rotate(0deg)` (points right), over
  `transform 240ms var(--ease-bounce)` (bouncy overshoot).
- **Body:** `.ktrack__body` animates `grid-template-rows: 1fr → 0fr` **and**
  `margin-top: 14px → 0`, both `320ms var(--ease-out)`. The inner
  `.ktrack__body-inner` is `overflow:hidden; min-height:0`, so it clips smoothly
  as the row track collapses — the height-animation-without-fixed-px technique.
- **Header border:** `.ktrack__head` border-color transition `var(--dur-fast)
  var(--ease-out)` on hover (trivial).
- **Jank finding:** animating `grid-template-rows` is smooth in modern engines;
  older Safari ignores it (snap to final, not jank — degrades acceptably). No
  layout thrash since the row track, not a measured pixel height, is animated.
- **Reduced motion:** **no component-local guard** — relies on the global tokens
  reduced-motion clamp (`animation/transition-duration → 0.01ms !important`).
  Verify the collapse becomes instant under `prefers-reduced-motion: reduce`.

## 7. Responsive
- **No own `@media` queries.** The header is a flex baseline row; the body
  inherits the host page's `.kcards` grid responsiveness (the grid itself has no
  media query — `repeat(auto-fill, minmax(300px,1fr))` reflows fluidly). The KPI
  and hero breakpoints (1100px, 700px) live in contracts-sections.css, not here.
  Verify the track within `/contracts` at its own page breakpoints.

## 8. A11y
- **Gaps (same as QuoteTrack):** the disclosure header is a `<header>` with an
  `onClick`, NOT a `<button>` — it is not keyboard-focusable or operable, and
  exposes no `aria-expanded`/`aria-controls`. The title is correctly an `<h2>`
  (good heading semantics) but the toggle target itself is not reachable by
  keyboard. **Rebuild fix:** make the header (or a wrapping element) a `<button>`
  (or `role="button"` + `tabindex=0` + Enter/Space key handlers) with
  `aria-expanded={open}` and `aria-controls` pointing at the `.ktrack__body` id.
  `user-select:none` is set to avoid text-selection on click.

## 9. Used on
**Only** `islands/ContractsPage.tsx` (`/contracts`) — mounted up to 4× (Tracks
01–04). Evidence: grep of `ContractTrack` import resolves solely to
`ContractsPage`. CSS lives in `static/contracts.css` (`.ktrack*` rules, extracted
to `css/contract-track.css`). It is a deliberate sibling of, not a reuse of, the
shared `QuoteTrack` (`shared-components/quote-track/`) — see that spec for the
`number`+`unit`+`lang` variant.
