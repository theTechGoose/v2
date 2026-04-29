# Invoice page header (`.qph__*`)

## What
The editorial top-of-page block. Eyebrow with a pulsing pink dot, big two-line headline (the dollar amount inside `<em>` is colored brand-pink), then a sub-paragraph describing what's overdue vs. on-the-way. Right side carries a "+ New invoice" CTA.

This same component (CSS class names + structural markup) appears on the Quotes page as `<QuotesHero>` with the same `qph` selector. The Invoices version differs only in copy (live counts come from `QPIPELINE` filtered by stage).

## Anatomy
- `.qph` — flex row with copy block + CTA. Padding 20px top, 24px bottom.
- `.qph__eyebrow` — uppercase tracker row, brand-pink color, leading dot.
- `.qph__eyebrow-dot` — `pulse-dot` (2.4s opacity loop).
- `.qph__title` — Nunito 800 38–42px headline. `<em>` swaps to pink.
- `.qph__sub` — body copy, `strong` highlights teal.
- `.qph__cta` — pink pill button.

## States
- `.qph__cta:hover` — translateY(-1px).

## Source
`pages/invoices/raw.html` lines 1748–1798 (CSS), 5006–5025 (markup).
