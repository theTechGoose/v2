# Annotation dots (`.annot__*`)

## What
Tiny "design label" used at the bottom of each viewport mockup ("Desktop · 1240 × 1040", "Mobile · 380 × 760"). It is purely a designer-facing annotation in this static export — not part of the live product UI.

## Anatomy
- `.annot` — flex row, uppercase 12px Nunito 700, muted color.
- `.annot__dot` — 8px pink circle by default; pages override the background inline (e.g. green for the mobile annotation).

## Source
`pages/dashboard/raw.html` lines 1727–1739 (CSS), 2804–2816 (markup).

## Animations
None.
