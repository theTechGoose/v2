# Capture checklist — InvoicesKpis

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/invoices` — the `.qkpi` strip directly below the hero,
  above the tracks.

## Viewports (from quotes.css `@media`)
- **1280px** — `repeat(4, 1fr)` (4 cells across).
- **1200px** boundary — at ≤1200 → `repeat(2, 1fr)` (2×2). Shoot just above and
  below 1200 to capture the reflow.
- **720px** — at ≤768 → `1fr` (single-column stack of 4 cells).

## Element(s) to crop
- The full `<div class="qkpi">` (all 4 cells: Overdue · Out for payment ·
  Drafting · Paid this month).
- A close crop of the **Overdue** cell in both states: with `--accent` (pink
  gradient, count>0) and without (plain white card, count=0).

## Transient states to drive
1. **default** — Overdue count>0 → Overdue cell shows `.qkpi__cell--accent`
   (pink `#fff1ed→#ffe4da` gradient, pink value text, pink-tinted border).
2. **no-overdue** — Overdue count=0 → accent removed, cell is plain white like
   the other three; value reads "$0".
3. **empty** — all zeros: every value "$0" (Drafting "0"), Drafting sub flips to
   "no drafts open"; Out sub "0 on the way"; Paid sub "0 cleared".
4. **es** — Spanish labels + invoice/payment units.

## Motion to film
- **None.** This strip has no animation (the accent gradient is static). Nothing
  to film; reduced-motion is moot. Confirm visually that no transition fires on
  the cells.

## Notes
- The Drafting cell's `.qkpi__val` is a raw COUNT (e.g. "2"), not a dollar
  amount — the only non-money value cell. Verify it doesn't render "$2".
- NO fabricated screenshots.
