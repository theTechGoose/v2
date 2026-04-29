# Features grid (`.features-grid` / `.feature`)

## What
Four feature cards in a 2×2 grid (or single column on narrow viewports), each with a colored icon tile and a title + paragraph. Tints come from `.feature-icon.{pink,green,teal,coffee}` modifiers, each carrying a tinted box-shadow that matches.

## Anatomy
- `.features` — section wrapper (110px vertical padding).
- `.features-grid` — 2-column grid, gap 24px.
- `.feature` — flex row tile: 56px icon + content. White, 1px border, 24px radius.
- `.feature-icon` — 56×56 colored square holding an inline SVG. Color modifier picks bg + tinted shadow.
- `.feature h3` / `.feature p` — heading + body.

## States
- `.feature:hover` — translateY(-3px) + larger shadow.

## Source
`pages/landing/raw.html` lines 1120–1160 (CSS), 2193–2243 (markup).

## Animations
None (CSS transition on hover only).
