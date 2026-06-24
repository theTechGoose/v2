# Capture checklist — QuotesSections

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/quotes` — all six sections render here:
  - **QuotesHero** (`.qph`) — top of page.
  - **QuotesKpis** (`.qkpi`) — 4-cell strip under the hero.
  - **DecidedRow** (`.qdone__row`) — inside Track 03 "Decided this month"
    (expand the collapsed track).
  - **QSideBig / QSideRate / QSideTip** (`.qside`) — the right sidebar (drops
    below the tracks under 1200px).

## Viewports
- **1280px** (full layout: sticky sidebar beside the tracks, 4-col KPIs).
- **1100px** (DecidedRow grid 2 → 1 col).
- **768px** (KPIs 2 → 1 col).
- **560px** (DecidedRow tightens + hides `.qdone__when`).
- Note the 1200px breakpoint: `.qph` stacks, `.qkpi` 4 → 2, `.qside` un-stickies.

## Element(s) to crop
- **Hero** — crop `.qph`; capture all three variants by seeding the pipeline:
  - **stale** (money headline + bold stale count) — the seeded default.
  - **warm** (all-warm copy) — needs a seed with 0 stale quotes.
  - **empty** ("Nothing in the pipeline yet.") — seed an empty account (or the
    isolate `hero-empty` case).
- **KPIs** — crop `.qkpi`; capture **confident** (decided≥5 → "67%") and
  **not-enough** (decided<5 → "—" win-rate cell). Threshold N=5.
- **Decided rows** — crop a won row (green ✓ badge) and a lost row (coffee ✗
  badge, struck-through amount). Include the `×` delete icon at the row end.
- **Sidebar** — crop each `.qside__card`: QSideBig (top-4 bars), QSideRate
  (gauge filled vs "—"), QSideTip (teal insight card).

## Transient states to drive
1. **qbar fill** — on (re)load the QSideBig bars animate width 0 → value/max over
   1.2s. Film once; capture the settled state.
2. **hero CTA** — "New quote" button: confirm it is a **dead stub** (click does
   nothing — no flip, no nav). Note in the capture.
3. **decided-row hover** — row slides `+2px` and border tints mint.
4. **delete-confirm** — the DecidedRow `×` → native confirm dialog (see
   delete-quote-button checklist); cancel to avoid the reload.
5. **win-rate threshold** — drive both sides of N=5 to capture the `—` vs `%`
   states in BOTH QuotesKpis and QSideRate.

## Motion to film
- **`.qbar__fill`** width 1.2s ease-out (slowest motion on the page) — re-triggers
  on every parent re-render (e.g. language flip); flag the re-animate.
- Hover micro-motions: `.qph__cta` (-1px), `.qdone__row` (+2px).
- QSideRate SVG is **static** (no arc animation) — no filming needed.
- Re-shoot with `prefers-reduced-motion: reduce` — no component-local guard;
  verify the global tokens clamp stills the bar fill + hovers.
