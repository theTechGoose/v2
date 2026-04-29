# Contract KPI grid (`.kkpi__*`)

## What
Slimmer 4-cell metric grid specific to the Contracts page. Renders just under the hero: In progress · Starting soon · Wrapping up · Closed in April.

## Anatomy
- `.kkpi` — `repeat(4, 1fr)` grid, 12px gap, 28px bottom margin.
- `.kkpi__card` — white tile with 1px border; `--accent` variant tints background and is paired with `--pink` numeral.
- `.kkpi__lbl` — uppercase label.
- `.kkpi__num` — Nunito 800 numeric. `--pink` modifier swaps to brand-pink.
- `.kkpi__sub` — small caption ("$14,800 active").

## Source
`pages/contracts/raw.html` lines 1968–2002 (CSS), 5157–5180 (markup).

## Animations
None.
