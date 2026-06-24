# Capture checklist — QuotesPage

- **Route:** `/quotes` (auth-gated — dev master OTP `000000`).
- **Viewports** (quotes.css real `@media`: 1200 / 1100 / 768 / 560px): 390, 768,
  1100, 1280.
- **Crop targets:** the `.content` island; the QuotesSections blocks (hero, KPIs,
  side rate gauge); a `QuoteCard` (front + flipped); the QuoteTrack tracks.
- **States to drive:**
  - `loading` — Skeletons on mount.
  - `ready` — populated from `lib/quotes-seed.ts` (`QPIPELINE`, 15 rows).
  - `empty` — no quotes (honest-empty).
  - `error` — fetch failure.
  - card moods: opened-hot, sent, draft, cooling/stale, won, lost.
- **Theme:** light only. **No fabricated screenshots** — capture against a seeded dev backend.
