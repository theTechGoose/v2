# QuoteCard

The pipeline quote card with a **flip-to-back engagement timeline**. A gradient
"mood" header + avatar + client/title/story + CTA/value foot on the front; click
flips to a back face showing the open-events timeline and a "reading" of the
prospect's behavior. Rendered one-per-quote inside the "Out for response" and
"Drafting" tracks on `/quotes`.

## 1. Classification & behavior

- **Bucket:** `island` (`islands/QuoteCard.tsx`).
- **Interaction tier:** `island` — **client-only state**, no data fetch of its
  own. It is a presentational card that receives a fully-built `Quote` from its
  parent island (`QuotesPage` via `mapCard`).
- **Server action + flash:** none directly. Its `qcard__back-foot` does host a
  child mutation — `<DeleteQuoteButton id={q.id}>` (variant `"btn"`) — whose
  delete path is the page-level reload anti-pattern (see delete-quote-button
  spec). The other three foot buttons are **client-only**: Resend is a dead stub
  (`onClick=stopPropagation` only), Copy-link writes `navigator.clipboard`, View
  -as-client does `globalThis.open('/q/:id','_blank','noopener')` (a real new-tab
  navigation, justified — not a reload).
- **Island client-state + refresh:**
  - `flipped: boolean` (`useState`) — front/back face. Set true on a card click
    (unless the click originated inside `.qcard__cta`, `.qcard__flip-hint`, or
    `.qcard__back`); reset false by the back-face close button.
  - `copied: boolean` (`useState`) — momentary "Copied!" label after a successful
    clipboard write; auto-reverts after `1500ms` via `setTimeout`.
  - `lang` is a **prop** (default `"en"`), NOT read from `langSignal` here — the
    parent (`QuotesPage`) reads `langSignal.value` and passes it down, so the
    card re-renders with the page.
- **`location.reload()` FLAG:** not in this file — but its child
  **`DeleteQuoteButton` calls `globalThis.location.reload()`** after a successful
  delete. The card holds no list state, so it cannot remove itself; the reload
  lives one level down. Flagged here because the Delete button only ever appears
  inside this card's back foot (btn variant) and the decided-row (icon variant).
- **Data source:** none of its own — all display fields are pre-derived props on
  the `Quote` object. The story (`QSTORIES[q.id]`), mood palette
  (`moodForQuote(q)`), open-events (`buildOpens(q)`), and behavioral "reading"
  (`readingFor(q, opens)`) are all computed **synchronously from the seed
  helpers in `lib/quotes-seed.ts`** at render — there is no network read. On the
  live path the engagement data arrives baked into the `QuoteCard` DTO from
  `GET /quotes` and is mapped into the presentational `Quote` by the parent.
- **Honest-empty:** if `q.opens === 0`, `buildOpens` returns `[]` → the back face
  renders the `quoteCard.back.noOpens` line instead of a timeline, and the front
  hides the `.qcard__opens` badge (`showOpens = stage !== "draft" && opens > 0`).
- **Liveness:** none. Frozen props; no polling/websocket. A customer opening the
  quote after mount won't bump the opens count without a parent re-fetch (which
  only happens on a language flip or full reload).
- **Reactivity / i18n:** `lang` prop drives every label via `tFor(lang, …)`
  (CTA, value label, back eyebrow/opens/buttons). The `cta` text is a 7-way
  branch on `q.stage` (+ an `opens >= 3` sub-branch for `opened`).
- **Data-shape hazards:**
  - **`value` UNIT MISMATCH (seed dollars vs live cents).** `q.value` is passed
    straight to `fmtMoney`, which is **cents** by contract and intentionally NOT
    unit-tolerant. On the **live** path `mapCard` copies `c.estimatedTotal`
    (CENTS) → renders correctly. But the **static seed** `QPIPELINE` literals are
    in **DOLLARS** (`value: 3850` for Q-1107), predating the audit#3 cents
    unification — feeding the raw seed value to `fmtMoney` would render "$39"
    instead of "$3,850". **Cases here use CENTS** (`385000`) to match the live
    `mapCard` contract that actually feeds this island; do not copy the seed
    literals verbatim into a fixture or the money reads wrong.
  - **`band`/`shadow` are dead passengers.** The `Quote` carries `band`/`shadow`,
    but the card recomputes the real per-stage palette via `moodForQuote(q)` and
    writes `--mood-from/-to/-shadow/-status` inline. `mapCard` hard-codes
    band/shadow to the pink ramp for every quote — never read here.
  - **`opened` has two moods.** `moodForQuote` returns `opened_hot` (orange ramp)
    when `stage==="opened" && opens >= 3`, else the green `opened` ramp — so two
    "opened" cards can look different. The CTA mirrors this (`sendOffer` vs
    `friendlyNudge`).
  - **`stage`, not `status`.** This card is keyed entirely off the derived
    **`stage`** (draft/sent/opened/cooling/stale/won/lost), never the stored
    `status`.
  - The `.qcard__flip-hint` pill has CSS but is **not rendered** by the TSX
    (`onCardClick` even guards against clicks on it) — dead selector.

## 2. Anatomy

```
<article class="qcard [qcard--flipped]" style="--mood-from/-to/-shadow/-status" onClick=onCardClick>
  ── FRONT ──
  <div class="qcard__mood">                               ← gradient header (mood ramp)
    <div class="qcard__numeral">{idx+1 padStart 2 '0'}</div>  ← giant faint "03"
    <div class="qcard__status"><span dot/> {stageLabel[stage]}</div>
    {showOpens && <div class="qcard__opens"><OpenDots count=min(opens,5)/> {opens}×</div>}
  </div>
  <div class="qcard__av">{q.initials}</div>               ← avatar, overlaps mood+body
  <div class="qcard__body">
    <div class="qcard__client-name">{q.client}</div>
    <h3 class="qcard__title">{q.title}</h3>               ← 2-line clamp
    <p class="qcard__story">{QSTORIES[id] ?? fallback}</p> ← 4-line clamp
  </div>
  <div class="qcard__foot">
    <button class="qcard__cta" type=button onClick=stopProp>{cta} <span>→</span></button>
    <div class="qcard__val-wrap">
      <div class="qcard__val-lbl">{valueLabel}</div>
      <div class="qcard__val-num">{fmtMoney(value)}</div>
    </div>
  </div>
  ── BACK (absolute, covers front; opacity/transform toggled by --flipped) ──
  <div class="qcard__back" aria-hidden={!flipped}>
    <div class="qcard__back-head">                        ← gradient (mood ramp)
      <button class="qcard__back-close" onClick=close><I x/></button>
      <div class="qcard__back-eyebrow">{back.eyebrow}</div>
      <p class="qcard__back-big">{opens}<small>{opens label} · {firstName}</small></p>
    </div>
    <div class="qcard__back-body">
      {opens.length
        ? <div class="qcard__timeline">{opens.map → .qcard__topen (dot + when/time + device)}</div>
        : <div class="qcard__topen-meta">{back.noOpens}</div>}
      <p class="qcard__read">{reading.text}{reading.em && <em/>}{reading.tail}</p>
    </div>
    <div class="qcard__back-foot">                         ← 4 equal buttons
      <button>{back.resend}</button>                       ← dead stub
      <button onClick=copyPublicLink>{copied?linkCopied:copyLink}</button>
      <button onClick=open('/q/:id')>{back.viewAsClient}</button>
      <DeleteQuoteButton id={q.id}/>                        ← [island] btn variant
    </div>
  </div>
</article>
```
- **Slots/children:** none — fully driven by the `q` prop.
- **Icon dependency:** `I` + `ICN.x` from `lib/dash-icons.tsx` (copied to
  `js/dash-icons.tsx`).
- **Embeds:** `DeleteQuoteButton` [island, see its spec].

## 3. Props

| name | type | default | control | signal? |
|---|---|---|---|---|
| `q` | `Quote` (presentational seed shape; see below) | — (required) | object | no |
| `idx` | number (0-based; renders as `01`,`02`…) | — (required) | number | no |
| `lang` | `"en"\|"es"` | `"en"` | select | no (prop, not langSignal) |

`Quote` (from `lib/quotes-seed.ts` — the **presentational** shape, NOT the
`QuoteCard` DTO): `{ id, title, client, initials, customerId?, stage:
draft|sent|opened|cooling|stale|won|lost, value:number /*CENTS on live path*/,
daysIn, opens, sentDays:number|null, decidedDays?, band:[string,string],
shadow:string }`.

## 4. States → cases

| state | meaning | case |
|---|---|---|
| opened-hot | `stage:"opened"`, `opens:3` → orange `opened_hot` mood, opens badge, "Send the offer", "shopping" reading | `cases/opened-hot/opened-hot.json` |
| sent | `stage:"sent"`, `opens:0` → pink mood, NO opens badge, "Set a reminder" | `cases/sent/sent.json` |
| draft | `stage:"draft"`, `opens:0` → coffee mood, "Finish + send", draft reading | `cases/draft/draft.json` |
| stale | `stage:"stale"`, `opens:1` → red mood, "Win it back", stale reading | `cases/stale/stale.json` |
| won | `stage:"won"` → green mood, "Open quote" (decided; card-as-rendered) | `cases/won/won.json` |
| flipped | back face shown (timeline + reading + foot) | `cases/flipped/flipped.json` |
| es | Spanish CTA/labels/story | `cases/es/es.json` |

> Isolate note: `flipped` uses `"_signals": { "flipped": true }` to force the
> back face. The opens timeline, story, mood, and reading are all derived from
> the `q` prop by the seed helpers at render — no `_mocks` needed.

## 5. Events

- `ev.expect(e => e.source === "article.qcard" && e.type === "click")` → sets
  `flipped=true` (unless the click target is inside `.qcard__cta`,
  `.qcard__flip-hint`, or `.qcard__back`).
- `ev.expect(e => e.source === "button.qcard__back-close" && e.type === "click")`
  → `flipped=false` (+ `stopPropagation`).
- `ev.expect(e => e.source === "button.qcard__cta" && e.type === "click")` →
  `stopPropagation` only (no nav — keeps the card from flipping; CTA is inert).
- Copy-link button → `navigator.clipboard.writeText('{origin}/q/{id}')`, sets
  `copied=true` for 1500ms. View-as-client → `globalThis.open('/q/:id','_blank')`.
- Delete button click → bubbles into `DeleteQuoteButton` (confirm → delete →
  reload). Owned by that island's spec.

## 6. Motion (extracted)

- **Card hover:** `transform: translateY(-4px)` + deepened mood shadow over
  `320ms` (`--ease-bounce` on transform, `--ease-out` on shadow).
- **Flip:** `.qcard__back` animates `transform: translateY(8px) scale(.98) →
  translateY(0) scale(1)` over `380ms var(--ease-bounce)` + `opacity 0→1` over
  `240ms var(--ease-out)`; `pointer-events` flips none→auto. Not a 3D Y-rotation
  — it's a scale/fade reveal of an absolutely-positioned back face over the
  front (front stays put underneath).
- **Status dot:** `q-pulse-dot` keyframe — `opacity 1→.4→1` over `2.4s infinite`
  (the **only** keyframe in `static/quotes.css`).
- **CTA arrow / gap:** `.qcard__cta` `gap 6px→9px` on hover (`--dur-fast`); the
  inline `→ span` has `transition: transform 240ms` (no hover rule assigns a
  transform — effectively idle).
- **Jank finding:** the flip animates `transform`+`opacity` (compositor-friendly,
  smooth). The bounce easing (`cubic-bezier(.34,1.56,.64,1)`) overshoots scale
  past 1 then settles — intended. `.qcard__back-body` is `overflow-y:auto`, so a
  long timeline scrolls inside the flipped card rather than overflowing.
- **Reduced motion:** **no component-local guard** — relies on the global tokens
  reduced-motion clamp (`animation/transition-duration → 0.01ms`). Verify the
  flip becomes instant and the pulse dot stills.

## 7. Responsive

- **No own `@media`.** The card has fixed internal geometry (138px mood header,
  86px avatar). It reflows only via its parent grid: `.qcards` is
  `repeat(auto-fill, minmax(320px, 1fr))`, so cards drop to a single column once
  the track column is < ~320px wide. The page's `.qlay` 1fr+320px → 1fr collapse
  happens at **1200px** (quotes-page spec). Verify within those host widths; the
  card itself does not re-query.

## 8. A11y

- **Whole-card click via `<article onClick>`** — the front face is not a button
  and is not keyboard-operable; flipping requires a mouse/touch tap. Rebuild fix:
  make the card (or a clear affordance) a real `<button>`/`role`+`tabindex` with
  `aria-expanded` for the flip, or expose a focusable flip control.
- **Back face uses `aria-hidden={!flipped}`** — good (hides the off-screen face
  from AT), but because the front isn't `aria-hidden` when flipped, both faces
  can be in the a11y tree at once while the front sits behind. Confirm/clean up.
- The back-close button has an `aria-label` (`common.close`) — good. The CTA and
  foot buttons are real `<button type=button>` and focusable.
- Numeral/mood are decorative (`pointer-events:none`, `user-select:none`).

## 9. Used on

**`/quotes` only** (the flip `islands/QuoteCard.tsx`), rendered by `QuotesPage`
inside the "Out for response" (`outSorted`) and "Drafting" (`drafts`) tracks.
Verified by grep of `<QuoteCard` JSX usage across `routes/ islands/ components/`.

> **Correction to brief:** the flip island is **not** rendered on the dashboard
> or inside the assistant. `islands/DashboardPage.tsx` imports only the
> `QuoteCard` *DTO type* from `clients/quotes.ts` and renders its own
> `QuoteRow` (`quoteToRow`); `islands/AsstChat.tsx`'s `lastQuoteCard` (line
> ~1051) is a local action-card *message* variable, not this island. The
> `<QuoteCard …>` at `routes/q/[id].tsx:137` and `islands/PhoneChat.tsx:54` are
> **separate local components** with different prop shapes (`QuotePublic` /
> `QuoteCopy`), not this island. (PhoneChat's is the landing-demo card.) So the
> only live consumer of THIS island is `QuotesPage`.
