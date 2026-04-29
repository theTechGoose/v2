# Client segment bar (`.csegment2__*` / `.cseg2-row__*`)

## What
"Who's on your books" mini-chart in the right rail. Each row is a segment label · horizontal bar · count.

## Anatomy
- `.csegment2` — white card, 1px border, 24px radius, 18px padding.
- `.csegment2__title` — Nunito 800 14px teal section heading.
- `.cseg2-row` — flex row with 100px label · `flex:1` bar wrap · 24px count.
- `.cseg2-row__bar` — sunken-mint track, 6px tall, 999px radius.
- `.cseg2-row__fill` — colored fill set inline. Has a `transition: width 1s var(--ease-bounce)` so any data update animates in.

## Data (from segs array)
| Label | Pct | Count | Color |
|---|---|---|---|
| Property mgmt | 80 | 4 | green |
| Homeowners | 60 | 5 | pink |
| Small biz | 40 | 2 | teal |
| HOAs | 18 | 1 | coffee-500 |

## Source
`pages/clients/raw.html` lines 2280–2292 (CSS), 4302–4321 (markup).

## Animations
None on mount, but the fill width transitions over 1s with `--ease-bounce` if changed dynamically.
