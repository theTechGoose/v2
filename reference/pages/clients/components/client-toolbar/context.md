# Client toolbar (`.ctoolbar2__*`)

## What
Slim 3-column toolbar above the cards: search · filter chips · sort.

## Anatomy
- `.ctoolbar2` — white card with 1px border, 16px radius, 8px padding. Grid `1fr auto auto`.
- `.ctoolbar2__search` — sunken-mint pill input with leading search icon. Updates `query` state in `<ClientsPage>`.
- `.ctoolbar2__filters` — segmented control of `.ctoolbar2__filter` buttons. The `--active` modifier moves a single white pill onto the chosen tab. Each filter has a `.ctoolbar2__filter-count` chip.
- `.ctoolbar2__sort` — sunken pill button labeled "Warmth ⌄".

## States
- Filter `--active` → white background + small shadow + teal text. Active counts use green-50 / green-700 tint.

## Source
`pages/clients/raw.html` lines 2198–2243 (CSS), 3995–4021 (markup).

## Animations
None on the toolbar itself; the filter chip uses a CSS transition (`all var(--dur-fast) var(--ease-out)`) for the active-pill swap.
