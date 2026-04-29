# Invoice KPI grid (`.qkpi__*`)

## What
4-cell metric grid sitting under the page header. Same structural pattern as `pages/quotes/components/quote-kpi-grid/` (it's the same code path with different copy).

## Anatomy
- `.qkpi` — `repeat(4, 1fr)` grid, 12px gap, 28px bottom margin.
- `.qkpi__cell` — white tile, 1px border, 18px padding.
- `.qkpi__cell--accent` — tinted background; pairs with `.qkpi__val` overridden to brand-pink.
- `.qkpi__lbl` — uppercase label.
- `.qkpi__val` — Nunito 800 numeric.
- `.qkpi__sub` — caption.

## Data flow
Counts and totals are derived from `QPIPELINE` (the page's invoice list) — overdue+partial sums into Overdue, `out` sums into Out, drafts is a count, paid sums into Paid this month.

## Source
`pages/invoices/raw.html` lines 1799–1834 (CSS), 5037–5060 (markup).

## Animations
None.
