# QuoteTrack

Collapsible "track" group (numbered section + count + collapsible body) used to
group pipeline stages on the Quotes, Invoices and Payments pages.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/QuoteTrack.tsx`).
- **Interaction tier:** `island` (client-only state) — a controlled disclosure.
- **Client state owned:**
  - `open: boolean` — section expanded/collapsed. Seeded from
    `localStorage[storageKey]` (`"1"`/`"0"`) if a `storageKey` is given, else
    `defaultOpen`. Persisted to that key on every change (so a contractor's
    open/closed preference per track survives reloads).
- **Data source:** none of its own — it's a layout/disclosure shell. `count`,
  `title`, `num`, `unit` are **props** supplied by the parent page island; the
  body content comes via `children`.
- **Honest-empty:** the count label always renders (e.g. "0 quotes"); the body
  may be empty if the parent passes no children — the parent is responsible for
  its own empty state inside the body.
- **Liveness:** none (request-response via parent). No polling/websocket.
- **Anti-patterns:** none. State is local + persisted; no `location.reload`.
  (Note: `count` is a frozen prop — if the parent page island re-fetches, it must
  re-render QuoteTrack with the new count; QuoteTrack does not fetch.)
- **Reactivity / i18n:** `lang` is a prop (defaults `"en"`); the count label uses
  `tFor(lang, "quoteTrack.count.{one|other}", { n })` UNLESS a `unit` prop is
  given, in which case it builds `"{count} {unit}"`/`"{count} {unit}s"` directly
  (used by /invoices and /payments which want non-"quote" wording).
- **Data-shape hazards:**
  - `unit` pluralization is naive English (`unit + "s"`) — fine for
    "invoice"/"payment", wrong for irregular nouns. The localized path (no
    `unit`) only handles the `quote` unit.
  - `storageKey` collisions across pages would share open-state — parents must
    pass distinct keys per track.

## 2. Anatomy
```
<section class="qtrack [qtrack--collapsed]">
  <header class="qtrack__head" onClick=toggle>
    <span class="qtrack__chev"><I chev size=14 sw=2.5/></span>   ← rotates 90deg open / 0deg collapsed
    <span class="qtrack__num">{num}</span>                       ← e.g. "01"
    <span class="qtrack__title">{title}</span>                   ← e.g. "Out for response"
    <span class="qtrack__count">{count} {unit}s | tFor(...)}</span>
  </header>
  <div class="qtrack__body">
    <div class="qtrack__body-inner">{children}</div>             ← cards/rows slot
  </div>
</section>
```
- **Slots/children:** yes — `children` render inside `.qtrack__body-inner` (the
  parent page passes the track's cards/rows here).
- **Icon dependency:** `I` + `ICN.chev` from `lib/dash-icons.tsx` (copied to
  `js/dash-icons.tsx`).

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `num` | string (required) | — | text | no |
| `title` | string (required) | — | text | no |
| `count` | number (required) | — | number | no |
| `unit` | string | `undefined` (falls back to localized "quote") | text | no |
| `defaultOpen` | boolean | `true` | boolean | no |
| `storageKey` | string | `undefined` (no persistence) | text | no |
| `lang` | `"en"\|"es"` | `"en"` | select | no |
| `children` | ComponentChildren | — | (slot) | no |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| open | expanded body (`defaultOpen=true`) | `cases/open/open.json` |
| collapsed | `qtrack--collapsed`, body height 0 | `cases/collapsed/collapsed.json` |
| custom-unit | `unit="invoice"` (Invoices/Payments wording) | `cases/custom-unit/custom-unit.json` |
| zero | `count=0` → "0 quotes" | `cases/zero/zero.json` |
| es | Spanish localized count | `cases/es/es.json` |

## 5. Events
- `ev.expect(e => e.source === "header.qtrack__head" && e.type === "click")` →
  toggles `open`; writes `localStorage[storageKey]` when `storageKey` set.

## 6. Motion (extracted)
- **Chevron:** `transform: rotate(90deg→0deg)` over `240ms var(--ease-bounce)`
  (bouncy) when collapsing.
- **Body:** `grid-template-rows: 1fr → 0fr` (+ `margin-top 14px→0`) over `320ms
  var(--ease-out)`. This is the height-animation-without-fixed-px technique:
  the inner `.qtrack__body-inner` is `overflow:hidden; min-height:0` so it clips
  smoothly as the row track shrinks.
  - **Jank finding:** animating `grid-template-rows` is supported in modern
    engines and is smooth here; older Safari ignored it (snap, not jank). The
    `.qtrack__head` border-color transition (200ms) on hover is trivial.
- **Reduced motion:** no component-local guard — relies on the global tokens
  reduced-motion clamp. Verify the collapse becomes instant.

## 7. Responsive
- No own `@media` queries. The header is a flex row that wraps naturally; the
  body inherits the parent grid (`.qcards`, etc.) responsiveness. Verify within
  the host page's quotes.css breakpoints.

## 8. A11y
- **Gaps:** the disclosure header is a `<header>` with an `onClick`, NOT a
  `<button>` — it is not keyboard-focusable or operable, and exposes no
  `aria-expanded`/`aria-controls`. Rebuild fix: make the header a `<button>`
  (or add `role="button"` + `tabindex=0` + key handlers) with
  `aria-expanded={open}` and `aria-controls` pointing at the body id. `user-select:none`
  is set to avoid text-selection on click.

## 9. Used on
Shared across **3 page islands**: `islands/QuotesPage.tsx`,
`islands/InvoicesPage.tsx`, `islands/PaymentsPage.tsx`. Evidence: grep of
`QuoteTrack` import. CSS lives in `static/quotes.css` (Invoices/Payments pages
reuse the quotes track styles + the `unit` prop to relabel).
