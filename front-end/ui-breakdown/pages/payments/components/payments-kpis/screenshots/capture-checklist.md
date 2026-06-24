# Capture checklist — PaymentsKpis

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/payments` — the `.qkpi` 4-cell strip sits directly
  under the `.pph` hero. Child of the PaymentsPage island; its numbers follow
  the seeded payment data.

## Viewports (own `@media`, from quotes.css)
- **1280px** — 4 cells in one row.
- **1200px** — `repeat(2, 1fr)` (2×2 grid). Shoot at ~1199px.
- **768px** — single column (4 stacked). Shoot at ~767px.

## Element(s) to crop
- The full `<div class="qkpi">` strip (all four cells).
- The **In-transit** accent cell alone (pink gradient + pink value) to show it
  differs from the three plain white cells.

## Transient states to drive
1. **populated** — seed with landed + in-transit payments: all four cells carry
   real numbers; Avg shows "Nd".
2. **empty** — wiped account: every cell "$0"/"0", Avg shows "—" +
   "no paid history yet".
3. **with-transit** — at least one ACH(<2d)/check(<5d): the accent cell value is
   non-zero.
4. **es** — Spanish UI language: labels + the payment plural localize.

## Motion to film
- None — the strip is static (the accent gradient doesn't animate). No
  reduced-motion concern.

## Notes
- The "Needs attention" cell will read **0 / "$0 held up"** on every real seed
  (the attention status is never produced) — capture it as-is and note the dead
  metric; do not fabricate a non-zero attention value for a "real" screenshot.
