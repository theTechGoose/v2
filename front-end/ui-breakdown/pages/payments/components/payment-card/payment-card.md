# PaymentCard

The per-payment flip card (`.qcard`) on /payments. Front = mood gradient +
status + method pill + avatar + client·invoiceRef + the dominant amount + a human
note + a CTA + a method/ETA value cell. Back = the "Payment trail" + the note +
three action buttons. **All actions are no-ops** — this page is read-only.

## 1. Classification & behavior
- **Bucket:** local component of the PaymentsPage island
  (`islands/PaymentsPage.tsx` lines 656–782; `STATUS_MOOD` map lines 658–685).
  Not its own island — renders inside the page island, sharing its hydration
  boundary.
- **Interaction tier:** **island-child, client-state only (flip).** No
  form/PRG, no Fresh Partial, no fetch.
- **Client state owned:** `flipped: boolean` — the only state. (Contrast the
  sibling InvoiceCard, which owns busy/adjust/discount/CO state because it
  mutates; PaymentCard owns none of that.)
- **Server actions + flash:** **NONE.** Every button is a no-op:
  | button | location | handler |
  |---|---|---|
  | `.qcard__cta` (e.g. "View receipt") | front foot | `onClick={e => e.stopPropagation()}` only |
  | Receipt / Match invoice / Text client | back foot | `onClick={e => e.stopPropagation()}` only |
  | `.qcard__back-close` (X) | back head | `setFlipped(false)` (state only) |
  - No `fetch`, no `location.reload()`, no flash/toast. The card cannot change
    any data. **This is itself an anti-pattern: the buttons read as actionable
    but do nothing** (payments-page.md §8 flags this).
- **Data source:** the single `p: EnrichedPayment` prop (parent derives
  `client`, `initials`, `invoiceRef`, `daysAgo`, `whenLabel`, `note`, `status`,
  `etaDays` from the raw `Payment` + joined invoice/customer).
- **Liveness:** none.
- **Data-shape hazards:**
  - **`status` is invented client-side** (`deriveStatus` + `SETTLE_DAYS`): the
    `Payment` DTO has no status. ACH<2d / check<5d ⇒ `"transit"`; otherwise
    `"landed"`. `"attention"` is never produced. So in practice only the
    `landed` (green) and `transit` (teal) moods ever render; `attention` (pink)
    is a dead branch.
  - **`invoiceRef` is cosmetic:** `INV-` + first 6 chars of `invoiceId`,
    uppercased — not a real document number.
  - The CTA label/cta + back depend on `status` via the `STATUS_MOOD` map +
    `paymentsPage.mood.{status}.{label|cta}` i18n keys.
  - The value cell flips meaning by status: `transit` → "Expected" + `~Nd` ETA;
    else → "Method" + the method label.

## 2. Anatomy
```
<article class="qcard [qcard--flipped]"
         style="--mood-from/-to/-shadow/-status"
         onClick={flip-unless-flipped-and-not-on-.qcard__cta/.qcard__back}>
  <div class="qcard__mood">
    <div class="qcard__numeral">{idx+1 padded}</div>
    <div class="qcard__status"><span class="qcard__status-dot"/> {moodLabel}</div>
    <div class="qcard__opens" style="text-transform:uppercase">
       <I METHOD_ICON[method]/> {methodLabel}</div>      ← method pill (reuses __opens)
  </div>
  <div class="qcard__av">{initials}</div>
  <div class="qcard__body">
    <div class="qcard__client-name">{client} · {invoiceRef}</div>
    <div class="pcard__amount">{fmtMoney(amount)}</div>   ← dominant amount line
    <p class="qcard__story">{note}</p>
  </div>
  <div class="qcard__foot">
    <button class="qcard__cta">{moodCta} <span →/></button>   ← NO-OP
    <div class="qcard__val-wrap">
      <div class="qcard__val-lbl">{transit?"Expected":"Method"}</div>
      <div class="qcard__val-num">{transit&&etaDays ? "~Nd" : methodLabel}</div>
    </div>
  </div>
  <div class="qcard__back" aria-hidden={!flipped}>
    <div class="qcard__back-head"><button .qcard__back-close X/>
      <div class="qcard__back-eyebrow">Payment trail</div>
      <p class="qcard__back-big">{fmtMoney(amount)} <small>· {methodLabel}</small></p></div>
    <div class="qcard__back-body"><p class="qcard__read">{note}</p></div>
    <div class="qcard__back-foot">              ← three NO-OP buttons
      <button>Receipt</button><button>Match invoice</button><button>Text client</button>
    </div>
  </div>
</article>
```
- Deps: `STATUS_MOOD`, `METHOD_ICON`, `methodLabel` (from PaymentsPage.tsx),
  `fmtMoney`, `tFor`, `I`/`ICN.x`.
- `--mood-*` CSS vars are set inline per status (drive the mood gradient +
  hover shadow tint + status text color).

## 3. Props
| name | type | default | widget | signal? |
|---|---|---|---|---|
| `lang` | `Lang` (required) | — | select | no |
| `p` | `EnrichedPayment` (required) | — | object | no |
| `idx` | number (required) | — | number | no (drives the `.qcard__numeral`) |

`EnrichedPayment` = `Payment` + `client`, `initials`, `invoiceRef`, `daysAgo`,
`whenLabel`, `note`, `status` (`landed`|`transit`|`attention`), `etaDays?`.

## 4. States → cases
| state | meaning | case |
|---|---|---|
| landed (front) | green mood, "View receipt", method value cell | `cases/landed/landed.json` |
| transit (front) | teal mood, "View timeline", "Expected ~Nd" cell | `cases/transit/transit.json` |
| flipped | back face — trail + note + three no-op buttons | `cases/flipped/flipped.json` |
| attention (front) | pink mood, "Text client" — DEAD branch, kept for fidelity | `cases/attention/attention.json` |
| es | Spanish mood/cta/note/value | `cases/es/es.json` |

## 5. Events
- `ev.expect(e => e.source==="article.qcard" && e.type==="click")` when **not**
  flipped and the target is **not** inside `.qcard__cta, .qcard__back` →
  `flipped=true`.
- `ev.expect(e => e.source==="button.qcard__back-close" && e.type==="click")` →
  `flipped=false`.
- All other buttons: `ev.expect(... type==="click")` → `stopPropagation()` only
  (no state, no network). Confirm by predicate that nothing else fires.

## 6. Motion (extracted, from quotes.css)
- **Flip:** `.qcard__back` `transform: translateY(8px) scale(.98) → translateY(0)
  scale(1)` over `380ms var(--ease-bounce)` + `opacity 0→1` over
  `240ms var(--ease-out)`; `pointer-events` gated on `.qcard--flipped`.
- **Hover lift:** `.qcard:hover` `translateY(-4px)` + a bigger mood-tinted
  shadow (`var(--mood-shadow)`), `320ms` bounce.
- **Status dot:** `q-pulse-dot` opacity `1→0.4→1` over `2.4s` infinite (the only
  always-on animation).
- **CTA arrow:** the `→` span has an inline `transition:transform 240ms`;
  `.qcard__cta:hover` widens the gap.
  - **Jank finding:** transforms/opacity only → GPU-friendly, smooth. The
    pulsing dot is cheap. No layout-thrash.
- **Reduced motion:** no component-local guard — relies on the global tokens
  clamp. Verify the flip becomes instant and the dot stops pulsing.

## 7. Responsive
- No own `@media`. Inherits the `.qcards` grid
  (`auto-fill minmax(320px,1fr)`, →1 col `≤768px`). The card's internal layout
  is fixed (138px mood block, flex body/foot).

## 8. A11y
- The whole `<article>` is the flip click target but is **not a `<button>`, not
  focusable, has no `aria-expanded`** — keyboard users cannot flip it.
  **Fix:** add a focusable flip affordance + `aria-expanded`/`aria-controls`.
- `.qcard__back aria-hidden={!flipped}` correctly hides the back face from AT
  while collapsed; the close-X has `aria-label` (`common.close`).
- The no-op CTAs/buttons announce as actionable buttons but do nothing —
  remove them or wire them.

## 9. Used on
`/payments` only (rendered by PaymentsPage inside the Just-landed /
In-transit / Needs-attention tracks). Reuses the Quotes `.qcard*` CSS verbatim
plus `.pcard__amount` from `static/payments.css` — see `css/payment-card.css`.
