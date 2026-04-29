# Activity item (`.activity-item__*`)

## What
Single feed entry inside the "What we handled today" panel. Shows what the monsters (back-end automation) did on behalf of the user.

## Anatomy
- `.activity-item__icon` — 32px tinted square (background + color passed inline based on event kind: green for sent, pink for paid, coffee for note, etc.).
- `.activity-item__text` — sentence with bold actor (`<strong>`) followed by inline event text.
- `.activity-item__time` — 11px subtle timestamp.

Rows are separated by a 1px dashed coffee-10% border, removed on `:last-child`.

## Source
`pages/dashboard/raw.html` lines 1431–1446 (CSS), 2605–2615 (markup).

## Animations
None.
