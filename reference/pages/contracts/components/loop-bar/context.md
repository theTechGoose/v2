# Loop bar (`.loopbar__*`)

## What
The dark-teal "Today's loop" strip, present on the Contracts page (and the Clients page — same component). Surfaces the three drafted client check-ins with stacked avatars and a CTA to open them.

## Anatomy
- `.loopbar` — gradient teal panel, 24px radius. `::before` adds a soft green radial in the corner.
- `.loopbar__title` — kicker (`.loopbar__lbl` with pulsing dot) + headline (`.loopbar__h`).
- `.loopbar__avs` — overlapping avatar stack + meta line.
- `.loopbar__cta` — white pill button.

## States
- `.loopbar__cta:hover` — translateY(-1px).

## Animations
- `.loopbar__lbl-dot` — `pulse` (2.4s pink ripple).

## Source
`pages/contracts/raw.html` lines 2681–2745 (CSS), 4556–4570 (markup).

## Related
The Clients page renders this same component above its toolbar — see `pages/clients/components/client-loop/`.
