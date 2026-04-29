# Footer (`.footer` / `.footer-row`)

## What
Bottom-of-page meta band. Three-column layout: brand wordmark on the left (with green "Monsters" emphasis), inline link list in the middle, copyright string on the right. Quietly muted color palette so it doesn't pull focus from the contact section above.

## Anatomy
- `.footer` — section wrapper, top padding ~40px.
- `.footer-row` — flex row holding brand · links · copy with `justify-content: space-between`.
- `.brand` — `<a>` containing two spans, with the second span ("Monsters") set to `var(--brand-green)`.
- `.links` — inline-flex of `<a>` items. Hover swaps the text color to brand-pink.
- `.copy` — copyright string in muted color.

## Source
`pages/landing/raw.html` lines 1912–1925 (CSS), 2462–2476 (markup).

## Animations
None. Hover transition on link color only.
