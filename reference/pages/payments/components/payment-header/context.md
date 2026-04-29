# Payment header (`.pph__*`)

## What
The biggest editorial header across the suite. Two-column grid: a giant pink dollar amount + tagline on the left, a fanned-out stack of three rotated "payment stub" cards on the right.

## Anatomy

| Element | Role |
|---|---|
| `.pph` | Outer grid `1.15fr 0.95fr`, padding 32px. |
| `.pph__main` | Left column: eyebrow, title, sub, CTAs. |
| `.pph__eyebrow` | Pill with check icon and "Payments · April". Pink-tint background. |
| `.pph__title` | `clamp(40px, 5.4vw, 72px)` Nunito 800. |
| `.pph__title-amount` | Pink span containing the dollar amount; `<sup>$</sup>` is the smaller superscript. |
| `.pph__title-tail` | Smaller teal continuation line beneath the amount. |
| `.pph__sub` | 15px body copy with teal `<strong>` highlights. |
| `.pph__cta-row` | Inline-flex row of `.pph__cta` (filled pink) + `.pph__ghost` (outline) buttons. |
| `.pph__stack` | Right column. Holds three `.pph__stub` children with absolute positioning. |
| `.pph__stub` | Each card is rotated and offset; modifier `--1`/`--2`/`--3` picks top/rotate/zIndex. On `.pph__stack:hover` each stub translates a few px upward without changing rotate. |
| `.pph__stub-head` / `-av` / `-meta` / `-client` / `-when` | Header row of a stub. |
| `.pph__stub-amount` | Big number on the stub. |
| `.pph__stub-foot` | Method label + green "Landed" tag. |

## States
- `.pph__cta:hover` — translateY(-1px), 160ms ease-bounce.
- `.pph__ghost:hover` — sunken background.
- `.pph__stack:hover .pph__stub--N` — each stub bumps up by 1–3px (preserving rotation).

## Source
`pages/payments/raw.html` lines 1799–2007 (CSS), 5653–5701 (markup).

## Animations
None (pure CSS transitions only). See `animations.md`.
