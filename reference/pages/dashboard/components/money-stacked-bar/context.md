# Money stacked-bar (Outstanding panel) — `.money__*`

## What
The "Money owed to you" rollup panel. Shows the total receivable as a Ticker-animated dollar amount, broken out into three buckets via a stacked horizontal bar, then a list of the contributing invoices.

## Anatomy
1. `.money__head` — label + ticker amount on the left, "Nudge all" pink CTA on the right.
2. `.money__bar` — 8px pill containing three `.money__bar-seg` segments. Width % and background are passed inline:
   - Current → `var(--brand-green)`
   - 1–14 days → `var(--coffee-400)`
   - Overdue → `var(--brand-pink)`
3. `.money__legend` — three legend chips with dot color matching each segment.
4. **Detail list** — dashed-top-border block of inline-styled rows, one per invoice. Color of meta line tracks status (overdue → pink-700, due-soon → coffee-500, due-later → green-600).

## Why
The Outstanding panel sits in the bottom-right of the dashboard grid. It's the one place on the page where receivables are shown in totalled form — gives a glanceable sense of cash flow without leaving home.

## Source
`pages/dashboard/raw.html` lines 1385–1423 (CSS), 2538–2599 (markup).

## Related
- The "Nudge all" button is `.qbtn qbtn--nudge` — see `pages/quotes/components/quote-action-buttons/`.
- The Ticker count-up is the `<Ticker value={…}>` helper used elsewhere on the page (KPIs, hero amount).
