# Hero rotor headline (`.rotor` / `.rotor-track`)

## What
The animated word at the end of the hero headline that cycles through "quotes." / "contracts." / "invoices." / "paperwork." Each word slides up + blurs out as the next slides in.

## Anatomy
- `.rotor` — fixed-height pink container (color comes from `--brand-pink`).
- `.rotor-track` — relative-positioned stack of `.word` spans.
- `.word` — opacity 0, transform `translateY(8px)` and a slight blur. The active one gets `.in` (opacity 1, translate 0). Outgoing gets `.out` (opacity 0, translate -100%, blurred).

## Behavior (inline script)
- An interval (~3.4s) increments the active index modulo the word list.
- Existing `.in` becomes `.out`; the next becomes `.in`.
- A `data-en` / `data-es` attribute pair lets a language toggle swap copy without touching the rotor JS.

## Source
`pages/landing/raw.html` lines 419–456 (CSS), 1983–1994 (markup), inline rotor JS around line 2598.

## Animations
No `@keyframes`. Pure CSS transitions on opacity + transform + filter.
