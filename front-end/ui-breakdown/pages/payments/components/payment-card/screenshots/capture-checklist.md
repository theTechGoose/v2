# Capture checklist — PaymentCard

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/payments` — cards live inside the Just-landed (recent,
  ≤1d) and In-transit tracks as `.qcards` → `.qcard`. Child of the PaymentsPage
  island; you can't address one standalone.

## Viewports
- **1280px** — cards in a multi-column `.qcards` grid (`minmax(320px,1fr)`).
- **768px** — `.qcards` →1 col (full-width cards). Shoot at ~767px to confirm a
  single card spans the column.

## Element(s) to crop
- A **single `.qcard`** front face (mood block + numeral + status + method pill,
  avatar, client·invoiceRef, the dominant `.pcard__amount`, note, CTA + value
  cell).
- The same card **flipped** (back face: trail + big amount + note + the three
  action buttons).

## Transient states to drive
1. **landed** — a recent (≤1d) cash/zelle/card payment: green mood,
   "Landed" status, "View receipt" CTA, "Method" value cell.
2. **transit** — an ACH(<2d)/check(<5d) payment (in the In-transit track, expand
   it first): teal mood, "In transit", "View timeline" CTA, "Expected ~Nd" cell.
3. **flipped** — click the card body → the back face flips in. Click the back-X
   to flip back.
4. **attention** — **cannot be produced from real data** (the attention status
   is never derived). Only drivable in isolate via the `attention` case; do not
   stage a fake live screenshot — note it's a dead mood.
5. **es** — Spanish UI language: mood label/CTA, note, method, value cell
   localize.

## Interactions to exercise
- Click the card body (not on the CTA / not on the back) → flips to back.
- Click the front `.qcard__cta`, and each back-foot button → confirm **nothing
  happens** (no network, no reload) — they `stopPropagation` only. This is the
  no-op bug to evidence.

## Motion to film
- **Flip** — `.qcard__back` slides + scales in (`380ms var(--ease-bounce)`) +
  fades (`240ms ease-out`). Film one flip both directions.
- **Hover lift** — `.qcard:hover` rises 4px with a mood-tinted shadow
  (`320ms` bounce).
- **Status dot pulse** — `q-pulse-dot` opacity 1→.4→1 over 2.4s (always on).
- Re-shoot a flip with `prefers-reduced-motion: reduce` (global clamp — verify
  flip is instant + dot stops).

## Notes
- The card is not keyboard-focusable (flip is mouse-only) — note this when
  documenting; do not "fix" it for the screenshot.
