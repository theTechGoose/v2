# KPI card grid (`.kpis` / `.kpi__*`)

## What
A row of 4 metric cards rendered below the hero banner on the dashboard. Each card holds an icon tile, label, big numeric value, and a delta chip (`▲ 24%`, etc.) plus a sub-label.

## Layout
- Container: `.kpis` — CSS grid, `repeat(4, 1fr)` with 12px gap.
- Item: `.kpi` — white card, 18px radius, soft border. Slight hover lift (transform + shadow), 200ms ease-bounce on transform.

## Anatomy of `.kpi`
1. `.kpi__icon` — 36px tinted square. `background` and `color` are passed inline per item (e.g. `var(--coffee-50)` + `var(--coffee-600)`).
2. `.kpi__label` — uppercase 11px micro caps.
3. `.kpi__val` — 26px Nunito 800 numeric.
4. `.kpi__delta` — pill + ellipsizing sub-text. The pill modifier picks the color:
   - `.kpi__delta--up` — green (positive trend)
   - `.kpi__delta--neutral` — coffee (informational)
   - `.kpi__delta--warn` — pink (alert)

## States
- `.kpi:hover` — translateY(-2px) + shadow lg.

## Animations
None (no @keyframes). Just a CSS transition on transform + shadow.

## Source
`pages/dashboard/raw.html` lines 1095–1162 (CSS), 2440–2454 (markup).
