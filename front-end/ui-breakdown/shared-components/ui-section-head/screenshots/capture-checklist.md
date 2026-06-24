# Capture checklist — ui/SectionHead

**Theme:** light only.
**Caveat:** UNUSED in the app (zero imports). No live route renders it — capture
via **isolate**. Load **landing.css** for the marketing look (clamped large h2 +
eyebrow dot) or **verify.css** for the lighter variant; shoot both if
documenting the divergence.

## Viewports
- **1280px** and **640px** — to show the `clamp()` h2 scaling (landing.css
  variant) and the 720px-max centered block.

## Element(s) to crop
- The full `.section-head` block (eyebrow pill + h2 + lede), centered.

## States to drive
1. **full** — eyebrow + title + lede.
2. **no-eyebrow** — title + lede.
3. **title-only** — just the h2.

## Motion
- None.
