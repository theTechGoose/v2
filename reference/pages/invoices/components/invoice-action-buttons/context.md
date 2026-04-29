# Invoice action buttons (`.qbtn__*`)

## What
Small pill buttons used in the action row beneath each invoice/quote item. Two variants:

- `.qbtn--nudge` — filled brand-pink primary action ("Nudge by text").
- `.qbtn--view` — transparent ghost variant with the standard border ("View quote").

## Anatomy
- `.qbtn` — 11px Nunito 700, 5px·11px padding, 999px radius, white default. Inline-flex with a 5px gap so the icon SVG sits flush with the text.
- Both variants share the same dimensions; only color/background swap.

## Usage
- Pair them inside `.quote-item__cta` (Invoices/Quotes lists).
- The dashboard "Money owed" rollup uses `qbtn--nudge` standalone for "Nudge all".

## Source
`pages/invoices/raw.html` lines 1368–1382 (CSS), 4442–4443 (markup).

## Animations
None. No transition either — just static button pills.
