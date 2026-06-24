# Capture checklist — InvoiceCard

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/invoices` — the `.qcard` flip cards live inside the
  `.qcards` grid of each QuoteTrack. Different stages live in different tracks:
  - Overdue → Track 01 "Overdue · needs a poke"
  - Awaiting confirmation (claimed) → Track 02 (data-cy=awaiting-confirmation-track)
  - Out → Track 03 "Out for payment"
  - Scheduled → Track 04 "Upcoming" (data-cy=upcoming-track, defaultOpen=false)
  - Drafting → Track 05
  - Paid this month → Track 06 (defaultOpen=false)

## Viewports
- **1280px** — `.qcards` grid `auto-fill minmax(320px,1fr)` (multi-col).
- **720px** — at ≤768 (own `@media` in invoice-card.css) `.qcards`→1col;
  capture one full-width card.

## Element(s) to crop
- A single `<article class="qcard">` FRONT face per stage (6 mood gradients):
  - **overdue** pink (`#FFD9D9→#FF6B6B`), CTA "Send nudge"
  - **out** teal (`#C8DDE0→#56969E`), CTA "View invoice"
  - **claimed** amber (`#FFE7B5→#E5A331`), CTA "Okay, I got it", method subline
  - **scheduled** purple (`#E4E0F7→#8B7DBF`), CTA "Send now"
  - **drafting** brown (`#E1D7CD→#9C8074`), CTA "Finish + send"
  - **paid** green (`#CFE5C8→#5FA34F`), CTA "View receipt"
- The BACK face (flipped) — head gradient + close-X + big amount, the
  stage-specific `.qcard__read`, and the 4-button `.qcard__back-foot`.
- The BACK face with the **"Adjust invoice"** panel expanded (discount input +
  Apply, change-order desc/amount + Create link, the loaded CO list with
  per-pending Copy-link buttons, the approval link block).

## Transient states to drive
1. **front (×6 stages)** — captured above; the giant `.qcard__numeral` (idx+1
   padded) sits bottom-right of the mood block, the avatar (`.qcard__av`)
   overlaps mood+body.
2. **flipped** — click the card body (not the CTA/back) → `.qcard--flipped`
   slides the back in. `aria-hidden` flips to false.
3. **adjust-open** — on a non-paid flipped card, click "Adjust invoice ▾" →
   first open lazy-fetches `GET /api/invoices/:id/change-orders` and renders the
   panel + CO list. Drive a pending CO to show the "Copy link" → "Copied!"
   toast-less swap.
4. **busy** — trigger a CTA (e.g. claimed "Okay, I got it") → CTA shows "…", all
   back-foot buttons disabled until the `location.reload()` lands (FLAG: every
   mutation full-reloads; film the moment before reload).
5. **muted** — on overdue/out back-foot, toggle Mute → button reads "Muted".

## Motion to film
- **Flip:** `.qcard__back` `translateY(8px) scale(.98)→0,1` over `380ms
  --ease-bounce` + `opacity 0→1` `240ms --ease-out`. Film one flip both ways.
- **Hover lift:** `.qcard:hover` `translateY(-4px)` + mood-tinted shadow, `320ms`
  bounce.
- **Status dot:** `q-pulse-dot` opacity 1→.4→1, `2.4s` infinite (always-on).
- **CTA arrow:** the `→` span `transition:transform 240ms`; `.qcard__cta:hover`
  widens `gap 6→9px`; back-foot button hover `translateY(-1px)` + pink border.
- Re-shoot a flip + the pulsing dot with `prefers-reduced-motion: reduce` (global
  clamp — verify the flip is instant and the dot stops).

## Notes
- The `amount` IS the card title (`.qcard__title` = `fmtMoney(amount)`), not a
  job name. The `.qcard__client-name` reads "{client} · INV-XXXXXX".
- NO fabricated screenshots.
