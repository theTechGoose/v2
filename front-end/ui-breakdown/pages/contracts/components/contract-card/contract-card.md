# ContractCard

Per-contract pipeline card with a **flip-to-back** milestone timeline. The front
face shows a mood-colored gradient header (status pill + relative-time pill +
giant ghost numeral), an initials avatar, client/title/story, a progress bar
(paid / left), and a primary CTA + contract value. Clicking the card flips it to
a back face: a synthesized milestone checklist + 3 action buttons.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/ContractCard.tsx`).
- **Interaction tier:** `island` (client-only state) — a local flip toggle plus
  three full-navigation CTAs.
- **Client state owned + refresh:**
  - `flipped: boolean` (`useState(false)`) — front ↔ back face. **Not** persisted
    (resets on remount). No data refresh: the card consumes a frozen
    `ContractCard` prop (`c`) built once by the parent's `toContractCard()`. The
    card never re-fetches.
- **Server action + flash:** **none.** ContractCard performs no mutations. All
  "actions" are navigations, not writes — no PRG, no optimistic update, no flash.
- **`location.reload()` flag:** **no `reload()`** — but five hard navigations via
  `globalThis.location.assign(...)`:
  - front CTA → `c.ctaHref` (`/invoices` for active/wrapping-up/completed, else
    `/c/{id}`).
  - back "Invoice" → `/invoices`.
  - back "Text client" → `/assistant?seed=…` (encoded prompt).
  - back "View contract" → `/c/{id}`.
  These are **full page navigations**, not SPA routing. In a Fresh 2 rebuild they
  should be real `<a href>` anchors (the front CTA and the 3 back buttons are
  `<button onClick={location.assign(...)}>` today — anti-pattern: a link styled as
  a button, breaking middle-click / open-in-new-tab / right-click and needing JS
  to navigate). **Fix:** render anchors; keep the flip on the card surface only.
  No Partial/PRG fix applies (no server mutation happens).
- **Data source per region:** **none of its own.** Every visible value
  (`client`, `initials`, `title`, `story`, `status`, `when`, `pct`, `paid`,
  `left`, `total`, `cta`, `ctaHref`, the mood gradient custom-props) is a field
  on the `c: ContractCard` prop, produced by `lib/contracts-shape.ts`
  `toContractCard()` from the backend `Contract` (+ customer-name + quote-summary
  lookups) in the parent `ContractsPage`. No `clients/contracts.ts` /
  `ssrBackendGet` call here.
- **Honest-empty:** N/A at card level — the parent never renders a card without a
  contract. Missing dates collapse to `"—"` in `when`/milestone dates; missing
  customer → `"contractsShape.untitledCustomer"`; missing quote summary →
  `"contractsShape.signedContract"` (both resolved upstream in `toContractCard`).
- **Liveness:** request-response only. The status-dot has a **cosmetic** CSS
  pulse (`q-pulse-dot`, 2.4s) — it is **not** live data; it is decoration on every
  card regardless of real "liveness". No polling/websocket.
- **Reactivity / i18n:** `lang` is a prop (default `"en"`), threaded from the
  parent's `langSignal.value`. The card calls `tFor(lang, …)` for the static
  chrome labels (progress/paid/left/contract/close + the 3 action button labels +
  the assistant seed prompt). The data-derived strings (`status`, `when`, `story`,
  `cta`) are **already localized** inside `toContractCard()` and passed in as
  plain strings — the card does not re-localize them, so a language flip must
  re-run the parent's projection to fully re-localize.
- **Data-shape hazards:**
  - **Milestones are synthesized, not stored.** `buildMilestones()` fabricates a
    timeline: if no `startDate`/`completionDate`, three generic mood-keyed stops;
    else five fixed-offset stops (0 / 0.25 / 0.55 / 0.85 / 1.0 of the span) with
    `done = stop date < now`, and the first not-done stop after a done one tagged
    `current`. **This is presentational fiction** — when the backend grows a real
    Milestone shape, swap to consuming it. Do not treat these dates as real.
  - **`pct` / `paid` / `left` are interpolated, not actual ledger values.** In
    `toContractCard`: `completed`→100%, both dates present→linear days-elapsed,
    `wrapping-up`→90%, `starting-soon`→0%; `paid = total * pct/100`. These are
    *estimates of schedule progress dressed as payment progress* — they do NOT
    reflect real `Payment` rows. Flag for rebuild: bind to actual invoices/payments.
  - **Money unit boundary:** the card receives `total`/`paid`/`left` as
    pre-formatted dollar **strings** (`fmtMoney` already applied upstream from
    INTEGER CENTS). The card itself never does money math — keep it that way.
  - **`#{c.id.slice(0,8)}`** assumes an id ≥8 chars; fine for backend ids.

## 2. Anatomy
```
<div class="kcard [kcard--flipped]" style="--mood-from/--mood-to/--mood-shadow/--mood-status" onClick=onCardClick>
  <div class="kcard__mood">                                  ← gradient header, 138px, overflow:hidden
    <span class="kcard__status"><span dot/>{c.status}</span> ← pill, top-left (pulsing dot)
    <span class="kcard__when">{c.when}</span>                ← pill, top-right
    <span class="kcard__numeral">{(idx+1) zero-pad 2}</span> ← 96px ghost numeral, bottom-right (CLIP BUG, see §6)
  </div>
  <div class="kcard__av">{c.initials}</div>                  ← 86px avatar, overlaps mood/body seam
  <div class="kcard__body">                                  ← column flex
    <div class="kcard__client-name">{c.client} · #{id8}</div>
    <h3 class="kcard__title">{c.title}</h3>                  ← 2-line clamp
    <p class="kcard__story">{c.story}</p>                    ← 3-line clamp
    <div class="kcard__prog">                                ← margin-top:auto (pins to bottom)
      <div class="kcard__prog-row"><span lbl>Progress</span><span pct>{c.pct}%</span></div>
      <div class="kcard__prog-bar"><div class="kcard__prog-fill" style="width:{pct}%"/></div>
      <div class="kcard__prog-meta"><span>Paid {c.paid}</span><span>Left {c.left}</span></div>
    </div>
  </div>
  <div class="kcard__foot">                                  ← border-top, grid 1fr auto
    <button class="kcard__cta" onClick=stop+assign(ctaHref)>{c.cta} <I arrow/></button>
    <div class="kcard__val-wrap"><div lbl>Contract</div><div num>{c.total}</div></div>
  </div>

  <div class="kcard__back" aria-hidden={!flipped} onClick=stopPropagation>   ← absolute inset:0, z:10
    <div class="kcard__back-head">                           ← gradient
      <button class="kcard__back-close" onClick=stop+setFlipped(false)><I x/></button>
      <div class="kcard__back-eyebrow">#{id8} · {c.client}</div>
      <h4 class="kcard__back-big">{c.title}<small>{c.total} · {c.when}</small></h4>
    </div>
    <div class="kcard__back-body">                           ← scrollable milestone list
      {milestones.map → <div class="kcard__mile [--done][--current]">
         <span check><I check/></span><span name>{m.name}</span><span date>{m.date}</span></div>}
    </div>
    <div class="kcard__back-foot">                           ← 3 equal buttons
      <button onClick=assign('/invoices')><I invoice/> Invoice</button>
      <button onClick=assign('/assistant?seed=…')><I send/> Text client</button>
      <button onClick=assign('/c/{id}')><I contract/> View contract</button>
    </div>
  </div>
</div>
```
- **Icon dependency:** `I` + `ICN.{arrow,x,check,invoice,send,contract}` from
  `lib/dash-icons.tsx` (copied to `js/dash-icons.tsx`).
- **Mood custom-props:** set inline on the root from `c.moodFrom/moodTo/
  moodShadow/statusColor`; the gradient header, avatar, prog-fill, back-head,
  done-milestone check, and hover shadow all read them.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `c` | `ContractCard` (object, required) | — | (object — built by `toContractCard`) | no |
| `idx` | number (required) | — | number | no |
| `lang` | `"en"\|"es"` | `"en"` | select | no |

> `c` is the rich card shape (`lib/contracts-shape.ts`). In isolate it is supplied
> as a full object literal in each case (real values per data-model `Contract` →
> `toContractCard`); the control widget is the JSON object editor, not a scalar.

## 4. States → cases
Driven by `c.mood` (the dominant axis — it sets palette, status label, when,
story, cta, ctaHref, pct) plus the flip toggle.
| state | meaning | case |
|---|---|---|
| active | `mood="active"`, front face, day-of-N progress, pink/green/orange variant | `cases/active/active.json` |
| starting-soon | `mood="starting-soon"`, 0% pct, "Starts in N days", scheduled | `cases/starting-soon/starting-soon.json` |
| wrapping-up | `mood="wrapping-up"`, 90% pct, "Wraps in N days" | `cases/wrapping-up/wrapping-up.json` |
| completed | `mood="completed"`, 100% pct, "Closed", green | `cases/completed/completed.json` |
| draft | `mood="draft"`, no dates, "Draft — not sent", finish CTA | `cases/draft/draft.json` |
| stale | `mood="stale"`, "Stale draft", re-engage CTA | `cases/stale/stale.json` |
| flipped | back face open (milestone list + 3 actions) | `cases/flipped/flipped.json` |

## 5. Events
- `ev.expect(e => e.source === "div.kcard" && e.type === "click")` →
  `onCardClick`: if not already flipped AND the click target is **not** inside
  `.kcard__cta` or `.kcard__back`, set `flipped = true`.
- `ev.expect(e => e.source === "button.kcard__cta" && e.type === "click")` →
  `e.stopPropagation()` then `location.assign(c.ctaHref)` (does NOT flip).
- `ev.expect(e => e.source === "button.kcard__back-close" && e.type === "click")`
  → `e.stopPropagation()` then `setFlipped(false)`.
- `ev.expect(e => e.source === "div.kcard__back" && e.type === "click")` →
  `e.stopPropagation()` (back face swallows clicks so they don't re-flip).
- `ev.expect(e => e.source === "button.kcard__back-foot >> nth(0)" && e.type === "click")`
  → `stopPropagation` + `location.assign("/invoices")`.
- `ev.expect(e => e.source === "button.kcard__back-foot >> nth(1)" && e.type === "click")`
  → `stopPropagation` + `location.assign("/assistant?seed=…")`.
- `ev.expect(e => e.source === "button.kcard__back-foot >> nth(2)" && e.type === "click")`
  → `stopPropagation` + `location.assign("/c/{id}")`.

## 6. Motion (extracted from contract-card.css)
- **Card hover:** `.kcard` `transform: translateY(-4px)` + deeper mood-tinted
  shadow, over `transform 320ms var(--ease-bounce)` + `box-shadow 320ms
  var(--ease-out)`.
- **Flip-in:** `.kcard__back` rests at `translateY(8px) scale(.98)` `opacity:0`
  `pointer-events:none`; `.kcard--flipped .kcard__back` → `translateY(0) scale(1)`
  `opacity:1` `pointer-events:auto`, over `transform 380ms var(--ease-bounce),
  opacity 240ms var(--ease-out)`. (It is a fade+rise+scale "card lifts to front,"
  NOT a 3D rotateY flip — despite the "flip" name.)
- **Progress fill:** `.kcard__prog-fill` `transition: width 480ms var(--ease-out)`
  — animates when `pct` changes / on mount.
- **Status dot:** `q-pulse-dot` keyframe (opacity 1→.4→1) `2.4s infinite`. This
  is the single keyframe shared with quotes.css; **cosmetic, not live**.
- **CTA hover:** `.kcard__cta:hover { gap: 6px → 9px }` (arrow nudges) over
  `var(--dur-fast)`. Back-foot buttons: border/color/translateY(-1px) on hover.
- **Back-close hover:** background alpha `.22 → .38` over `var(--dur-fast)`.
- **Jank / clip BUG (real, flagged in CSS):** `.kcard__numeral` is `bottom:-18px`
  while `.kcard__mood` is `overflow:hidden` → the 96px numeral's descender is
  **clipped**. The sibling `.qcard__numeral` was fixed to `bottom:4px` (audit #30)
  but the fix was **not ported back here**. Rebuild: set `.kcard__numeral`
  `bottom:4px`. Not animation jank — a static clipping bug; capture it.
- **Reduced motion:** **no component-local block** — relies on the global tokens
  clamp. Verify hover-lift, flip, prog-fill, and pulse all still/snap under
  `prefers-reduced-motion: reduce`.

## 7. Responsive
- **No own `@media` queries.** The card is fixed-internal-layout; it reflows only
  via the host `.kcards` grid (`repeat(auto-fill, minmax(300px, 1fr))`, defined in
  this CSS for isolate context) — i.e. it goes 1-up below ~300px effective column
  width and N-up above, with no card-internal breakpoint. The mood header height
  (138px), avatar (86px), numeral (96px) are all fixed px. Verify legibility of
  the 2-line title clamp + 3-line story clamp at the narrowest single-column width.

## 8. A11y
- **Whole-card click without keyboard:** `.kcard` is a `<div onClick>` that flips
  — not focusable/operable by keyboard, no role/`aria-expanded`. **Fix:** the flip
  affordance should be a real control (or the card a `<button>` with
  `aria-expanded={flipped}` `aria-controls` → back-face id). Today only the inner
  `<button>`s are reachable.
- **Links-as-buttons:** front CTA + 3 back-foot actions are `<button>`s that call
  `location.assign` — they should be `<a href>` for native link semantics
  (focus, middle-click, screen-reader "link" role). Back-close is a real
  `<button>` with `aria-label` (good).
- **Back face hidden state:** `aria-hidden={!flipped}` is set on `.kcard__back`
  (good) — but the back content is still in the DOM and `opacity:0`
  `pointer-events:none` only; confirm focus can't tab into it while hidden
  (add `inert`/`tabindex=-1` management in rebuild).
- **Status pill** relies on color + the uppercase text label (text present —
  acceptable). The pulsing dot is decorative.

## 9. Used on
**Only** `islands/ContractsPage.tsx` (`/contracts`), rendered inside each
`ContractTrack` body as `<ContractCard c={…} idx={i} lang={lang} />`. Evidence:
grep of `ContractCard` import. It is the contracts twin of the shared `QuoteCard`
(`islands/QuoteCard.tsx`, owned separately) — similar `.k*`/`.q*` class lineage,
but a distinct component with the mood-palette + milestone-synthesis logic.
CSS: `static/contracts.css` `.kcard*` rules (extracted to `css/contract-card.css`).
