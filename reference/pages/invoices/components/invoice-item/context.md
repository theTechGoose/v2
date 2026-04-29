# Invoice / quote item row (`.quote-item__*`)

## What
A list-row variant used inside panels (the dashboard "Quotes awaiting" panel and the secondary lists on Invoices). Lighter than the full `.qcard` flip card — three rows: client + amount, sub-meta (description + status), CTA pair (`qbtn--nudge` + `qbtn--view`).

## Anatomy
- `.quote-item` — column flex with 6px gaps; bottom border dashed coffee 10%.
- `.quote-item__row` — first line: client (ellipsizing) + bold amount.
- `.quote-item__sub` — meta line; first span ellipsizes at 50% width to keep the status visible.
- `.quote-item__cta` — pair of small action pills.

## Source
`pages/invoices/raw.html` lines 1321–1366 (CSS), 4429–4448 (markup).

## Animations
None.

## Related
The action pills are `.qbtn__*` — see `../invoice-action-buttons/`.
