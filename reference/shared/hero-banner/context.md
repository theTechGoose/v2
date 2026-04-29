# Hero banner (`.hero__*`)

## What
Full-width welcome panel rendered as the first card in `.content` on dashboard pages. Soft mint-to-cream gradient background with two radial accents (pink corner + green corner), a 24px radius, and a bobbing mascot illustration on the right.

## Layout
A two-column grid: `1fr` (copy) + `240px` (art).

- **Copy column** (`.hero__copy`): optional pill (`.hero__pill`), title (`.hero__title` with pink `<em>` accent), subtitle (`.hero__sub`), stats row (`.hero__stats` of `.hero__stat` pills), CTA row (`.hero__cta-row` of `.btn` variants).
- **Art column** (`.hero__art`): blurred green blob backdrop + 3 confetti chips + bobbing mascot image (`.hero__monster`). Pages with a hot lead overlay a rotated `.hot-card` callout in the same area.

## Variants
- Default greeting: stats + CTA only.
- With sidecar metric: a `.hero__rev` revenue card sits in or beside the hero on some pages (Dashboard).
- With hot card: `.hot-card` is rendered inside `.hero__art`, and `.hero__monster` gets `--with-card` modifier (pushed down to make room).

## States
- `.hot-card:hover` — un-rotates, lifts -2px, deepens shadow (220ms ease-bounce).
- `.hot-card__cta:hover` — translateY(-1px) + scale 1.03; the trailing arrow svg shifts +2px.
- `.btn:hover` — translateY(-1px), filter brightness(1.05).

## Animations
- `hbob` on `.hero__monster` — 5.5s rotation + Y bob.
- `hotPulse` on `.hot-card__pulse` — 1.6s pink ring ripple.
- `ppulse` on `.hero__pill-dot` — 2s green ring ripple.

## Source
`pages/dashboard/raw.html` lines 793–1100 (CSS), 2399–2427 (markup).
