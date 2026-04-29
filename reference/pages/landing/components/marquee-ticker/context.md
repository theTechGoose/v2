# Marquee ticker (`.marquee` / `.marquee-track`)

## What
Full-bleed horizontal scrolling strip of brand testimonials/value-props. Sits directly under the hero. Background is brand-teal with mint text.

## Anatomy
- `.marquee` — full-width band, 22px vertical padding, `overflow: hidden`.
- `.marquee-track` — flex container that gets duplicated by JS so the loop is seamless. Plays `marquee` keyframe (translateX 0 → -50%).
- Phrases separated by `.dot` (pink or green colored circles).

## Behavior
JS reads `data-en` (and `data-es` for the language toggle) and splits on `|` to render `<span class="phrase">` items separated by alternating-color dots. The contents are duplicated to make the seamless infinite scroll work.

## Source
`pages/landing/raw.html` lines 2106–2111 (markup); CSS in `extracted/styles.css` lines 391–416 (`.marquee` / `.marquee-track` / `.dot` / the `marquee` keyframe).

## Animations
`marquee` keyframe: `translateX(0)` → `translateX(-50%)`. Continuous. See `shared/design-tokens/motion.md`.
