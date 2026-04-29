# Client top summary (`.ctop2__*`)

## What
Right-rail "Top of the leaderboard" card. Dark teal background with a soft pink radial accent in the top-right corner. Lists 5 top clients with rank, name, total revenue, and a relative-share progress bar.

## Anatomy
- `.ctop2` — teal card, 24px radius, decorative `::before` pink radial blob.
- `.ctop2__head` — title + period text ("last 12 mo").
- `.ctop2__item` — 3-column grid `22px 1fr auto` for rank · name · amount.
- `.ctop2__rank` — Nunito 800 11px, white-50% opacity. `.ctop2__rank--1` overrides to gold (#FFD56B).
- `.ctop2__bar-wrap` + `.ctop2__bar` — relative-share bar, pink-gradient fill, width set inline.

## Source
`pages/clients/raw.html` lines 2247–2278 (CSS), 4221–4251 (markup).

## Animations
None.
