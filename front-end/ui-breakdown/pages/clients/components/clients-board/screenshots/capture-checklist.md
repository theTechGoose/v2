# Capture checklist — ClientsBoard

**No backend running → NO fabricated screenshots.** Capture only against the
live app once it's served. Light theme only (the app has no dark mode).

**Theme:** light only.
**Auth:** dev master OTP `000000` (phone login → 000000).

## Route / URL
- `http://localhost:5280/clients` (frontend :5280; backend :4280 must be up so
  the island's on-mount `/clients`, `/analytics/clients/top`, `/segments`
  fetches resolve — otherwise the board renders its empty branch).
- Filter deep-links: `…/clients?segment=owes`, `?segment=active`,
  `?segment=lead`, `?segment=regular`, `?segment=cold` (each pre-selects a chip
  via `filterFromSearch`).

## Viewports (this component's real @media in clients.css)
- **1280px** — full two-pane (`.clay2` 1fr + 280px rail; multi-column card grid).
- **1100px** — boundary: `.clay2` collapses to one column (rail drops below).
- **768px** — `.ccards2` → 1 column; `.ctoolbar2` stacks; `.ctoolbar2__filters`
  scrolls horizontally. (Also capture just-above at 769px to show the toolbar
  still in its 3-column grid.)

## Element(s) to crop
- The `.ctoolbar2` row (search + 6 filter chips with counts + Warmth sort).
- A single `.ccard2` (mood banner + ghost since-number + status chip + avatar +
  body + footer) — closed.
- The same card with `.ccard2--open` (slide-up `.ccard2__panel` visible).
- The empty cell (`.ccards2__empty`).

## Transient states to drive
1. **filter** — click each filter chip; confirm `aria-pressed`, the active chip
   pill, the count badges, and that the URL gains/loses `?segment=`. Use browser
   Back to confirm `popstate` re-applies the filter.
2. **search** — type in `.ctoolbar2__search` (e.g. "maple"); grid narrows live.
3. **card open** — click a card body → panel slides up. Then: click outside →
   closes; press Escape → closes; click the `.ccard2__panel-x` → closes.
4. **no-matches** — type a non-matching query with a non-empty roster →
   `clientsBoard.empty.noMatches`.
5. **es** — toggle UI language to Spanish (topbar) → chips + card chrome
   localized.

## Motion to film (from clients.css)
- **Card hover lift** — `translateY(-4px)` + shadow over 320ms (bounce/out).
- **Panel slide-up** — `translateY(8%→0)` 380ms bounce + opacity 240ms (toggle a
  card open).
- **Status dot pulse** — `pulse-dot 2.4s` (opacity 1↔0.4), film one cycle.
- **Close-button rotate** — hover `.ccard2__panel-x` → 90deg.
- **Dead entrance (do NOT expect motion):** `ccard2-editorial-in` is declared but
  unapplied — confirm cards appear instantly with NO staggered fade (documents
  the bug). Re-film after the rebuild fix applies the animation.
- Re-shoot any of the above with `prefers-reduced-motion: reduce` (relies on the
  global tokens clamp) — verify hover/slide/pulse go instant.
