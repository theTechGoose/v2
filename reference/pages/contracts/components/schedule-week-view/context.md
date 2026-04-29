# Schedule week view (`.csched__*`)

## What
A 30-day rolling schedule strip that shows every committed contract as a horizontal lane-packed bar. Dark teal panel with a subtle two-radial accent. A vertical "TODAY" line crosses the row containing the current day.

## Layout
- `.csched` — gradient teal panel, 24px radius. `::before` adds a soft pink+white radial pattern.
- `.csched__head` — eyebrow, headline, and legend chips on the right.
- `.csched__grid` — vertical stack of `.csched__weekrow` rows.
- `.csched__weekrow` — `60px 1fr` grid: week label · weekbar.
- `.csched__weekbar` — relative positioning surface, height controlled via `--lanes-h` CSS var (recomputed per row based on lane count: `lanes * 22 + (lanes-1)*4 + 6`).
- `.csched__bar` — absolute-positioned gradient bar; `--bar-from` / `--bar-to` drive its color, `left/width/top/height` set inline.
- `.csched__bar--scheduled` overlays a 45° dashed pattern via `repeating-linear-gradient`.
- `.csched__today` — 2px pink vertical line with a glowing TODAY chip pinned via `::before`.

## Lane packing
JS computes lane assignments greedily: each contract takes the lowest-indexed lane that's free for its full span. A lane is reserved across the whole strip so bars never jump between rows.

## States
- `.csched__bar:hover` — `scaleY(1.1)` and `brightness(1.1)`. 240ms ease-out.

## Source
`pages/contracts/raw.html` lines 1452–1560 (CSS), 5066–5155 (component logic + markup).
