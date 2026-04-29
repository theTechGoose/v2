# Contract track (`.ktrack__*`)

## What
Collapsible section that hosts a row of contract cards. Used 3× on the Contracts page (In progress / Starting soon / Wrapping up). The "Quotes" and "Invoices" pages use a structurally identical `.qtrack` — see those pages for the variant.

## Anatomy
- `.ktrack__head` — clickable row: chev · `01` numeral (pink) · title · right-aligned count meta. 1px bottom border that intensifies on hover.
- `.ktrack__chev` — chevron icon, baseline rotated 90° (pointing down). On collapse it rotates back to 0°.
- `.ktrack__body` / `.ktrack__body-inner` — the grid-template-rows trick (1fr → 0fr) animates collapse without measuring height in JS.
- `.kcards` — inner grid of contract cards (auto-fill, 320–360px columns depending on viewport).

## States
- Default: open. `defaultOpen={true}` in the export.
- `.ktrack--collapsed`: chev points right, body height collapses to zero, top margin removes.

## Source
`pages/contracts/raw.html` lines 1563–1604 (CSS), 5269–5290 (markup).
