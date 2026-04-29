# Problem cards (`.problem-grid` / `.problem-card`)

## What
Three pain-point statements rendered in a 3-column grid below the marquee. Each card has a big numerical kicker (01/02/03), an h3 statement, and a short paragraph.

## Anatomy
- `.problem` — section wrapper with vertical padding 110px.
- `.problem-grid` — 3-column grid, 24px gap.
- `.problem-card` — white tile, 1px border, 24px radius, 28px padding. Hover lifts via translateY(-4px) and `--shadow-lg`.
- `.problem-card .num` — large pink Nunito 800 number tag.

## Source
`pages/landing/raw.html` lines 928–963 (CSS), 2114–2140 (markup).

## Animations
None. Hover transition only (lift + shadow).
