# Invoice track (`.qtrack__*`)

## What
Collapsible section that wraps a row of invoice/quote cards. Structurally identical to the Contracts page's `.ktrack__*` — same chevron, same grid-rows collapse trick — under a different selector prefix.

## Anatomy
- `.qtrack__head` — clickable row: chev · `01` numeral (pink) · title · right-aligned count meta. 1px bottom border that intensifies on hover.
- `.qtrack__chev` — chevron, 90° rotated to point down. Returns to 0° when collapsed.
- `.qtrack__body` / `.qtrack__body-inner` — grid-template-rows trick (1fr → 0fr) animates collapse.
- `.qcards` — inner grid of `.qcard` items (auto-fill, ~320px columns).

## States
- Default open (`defaultOpen={true}`); `Drafting` and `Paid this month` use `defaultOpen={false}`.
- `.qtrack--collapsed` flips chev rotation and zeroes the body height.

## Source
`pages/invoices/raw.html` lines 1836–1885 (CSS), 5253–5269 (markup).
