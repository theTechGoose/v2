# Quote page header (`.qph__*`)

## What
Same component as `pages/invoices/components/invoice-page-header/`. Editorial top-of-page block with eyebrow, big two-line headline (pink `<em>`), sub-paragraph, and "+ New quote" CTA. Copy is filtered from `QPIPELINE` by stage to derive open total + stale count.

## Source
`pages/quotes/raw.html` lines 1748–1798 (CSS), 4988–5012 (markup).

## Animations
- `.qph__eyebrow-dot` — `pulse-dot` (2.4s).
- `.qph__cta:hover` — translateY(-1px).

See `motion.md` and `pages/invoices/components/invoice-page-header/` for full notes.
