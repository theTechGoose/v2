# Panel (`.panel__*`)

## What
The white card wrapper used to frame every list-style section across dashboard pages: Active jobs, Quotes awaiting, Daily summary, Money owed, etc. Always paired with a header row.

## Anatomy
- `.panel` — white card, 20px radius, soft border, `overflow: hidden` so child rows don't break the corner.
- `.panel__head` — top bar: a pulsing dot (optional) + title + green-pill count + right-aligned action link. Has a 1px bottom border.
- `.panel__title` — Nunito 800 14px teal.
- `.panel__count` — green-pill badge ("7 active"). Some pages override `background` + `color` inline (e.g. coffee for "$12,800").
- `.panel__action` — green text link ("See all →"), pushed to the right with `margin-left: auto`.

The body of the panel has no class — pages drop in `.job` rows, `.quote-item` rows, etc.

## Companion: `.grid`
Two-panel rows use a sibling `.grid { grid-template-columns: 1.45fr 1fr; }` wrapper to size a wide content panel next to a narrower side panel.

## Source
`pages/dashboard/raw.html` lines 1171–1219 (CSS), 2466–2499 (markup).

## Animations
None. Hover on `.panel__action` and the count badge is left to default text behavior.
