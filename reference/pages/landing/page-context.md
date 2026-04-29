# Landing

## Purpose
The marketing site. Sells contractors on the Paperwork Monsters product through a story-led hero (rotating headline + animated phone), a marquee, problem cards, animated document tabs, features grid, "how it works", a phone-in-frame demo, pricing, contact form, and footer.

This is the only page that doesn't share the dashboard chrome (sidebar / topbar / phone preview). It is its own self-contained marketing layout, mostly written with the global `styles.css` and a large per-page `<style>` block.

## Top-level structure
A flat document — no `.stage` / `.window` / `.app` shell. Each section is a top-level block in the body:

1. `<section class="hero">` — Hero with rotating word headline + phone visual + trust avatars + CTAs.
2. `<div class="marquee">` — Full-width brand testimonial ticker.
3. `<section class="problem">` — 3-card grid of pain-point statements.
4. `<section class="docs">` — Animated tabs cycling through quote → contract → invoice mockups.
5. `<section class="features" id="features">` — 4-card features grid.
6. `<section class="how" id="how-it-works">` — How it works.
7. `<section class="demo">` — In-frame phone demo.
8. `<section class="pricing" id="pricing">` — Pricing card stack.
9. `<section class="contact" id="contact">` — Two-column contact card with chat-style form preview.
10. `<footer class="footer">` — Dark multi-column footer.

The hero uses a 2-col grid: `.hero-copy` on the left, `.hero-visual` (`.hero-stage` containing `.hs-phone`) on the right.

## Layout chrome (uses `shared/`)
- `shared/design-tokens` — typography, color, spacing, motion all come from here.
- The hero phone (`.hs-phone__*`) is unique to landing — different styling from `shared/phone-preview`. Documented in `components/hero-phone-mockup/`.

## Page-unique components
- [hero-rotor](components/hero-rotor/) — `.rotor` / `.rotor-track` rotating-word headline.
- [hero-phone-mockup](components/hero-phone-mockup/) — `.hs-phone__*` chat phone visual + ambient blobs + floating doc/badge.
- [marquee-ticker](components/marquee-ticker/) — `.marquee` full-bleed brand strip.
- [problem-cards](components/problem-cards/) — `.problem-grid` of `.problem-card`.
- [document-tabs](components/document-tabs/) — `.docs` cycling sample documents.
- [features-grid](components/features-grid/) — `.features-grid` of `.feature`.
- [contact-section](components/contact-section/) — `.contact` two-column form with `.cf-phone` chat preview.
- [footer](components/footer/) — `.footer` dark multi-column.

The "How it works", "Demo", and "Pricing" sections are present in the source but were not in the plan; the closest folder is `features-grid` (the features grid). If they're worth their own folders later, add them under `components/`.

## Notable interactions / animations
- Hero rotor (`.rotor-track`) cycles words on a setInterval, blur+slide between each.
- Hero phone (`.hs-phone`) bobs (`phoneFloat`), with two ambient `.hs-blob` (`blobDrift`), a floating `.hs-doc` (`docFloat`), and a floating `.hs-badge` (`badgeFloat`).
- Marquee track loops with `marquee` keyframe.
- Sparkles in the hero use `twinkle`.
- Contact form preview uses `cfPulse`, `cfDot`, `cfSlideIn` for a chat-bubble entry effect.
- Smooth-scroll is enabled via `html { scroll-behavior: smooth; }` so anchor links jump nicely.

## Source
`extracted/Paperwork Monsters Landing.html` (also at `pages/landing/raw.html`).
Global landing styles also live in `extracted/styles.css`.
