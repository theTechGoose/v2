# Quotes

## Purpose
The pipeline view: every quote that's been drafted, sent, opened, or decided. Surfaces what's open, which ones are cooling off (and need a nudge), what's still in draft, and recent wins/losses. Mirror image of Invoices, with `stage` values shifted from receivables (overdue/out/draft/paid) to pipeline (draft/sent/opened/cooling/stale/won/lost).

## Top-level structure
Standard chrome. `<QuotesPage>` composes:

1. **`<QuotesHero>`** — `.qph` editorial header ("The pipeline this week").
2. **`<QuotesKpis>`** — `.qkpi` 4-cell breakdown: Out for response · Drafting · Decided this month · Win rate.
3. **`.qlay`** layout — main column + `.qside` rail:
   - **Main**: 3 collapsible `<Track>` sections.
     - `01 Out for response` — sorted by stage (opened > sent > cooling > stale).
     - `02 Drafting` — `defaultOpen={false}`.
     - `03 Decided this month` — uses `<DecidedRow>` instead of `<QuoteCard>`; `defaultOpen={false}`.
   - **Side rail** (`<aside class="qside">`):
     - `<QSideBig>` — big stat card.
     - `<QSideRate>` — win-rate spark/breakdown.
     - `<QSideTip>` — copy nudge.

## Layout chrome (uses `shared/`)
- `shared/sidebar`, `shared/topbar`, `shared/annotation-dots`, `shared/phone-preview`.

## Page-unique components
- [quote-page-header](components/quote-page-header/) — `.qph__*` (same component as Invoices).
- [quote-kpi-grid](components/quote-kpi-grid/) — `.qkpi__*` 4-cell grid (same).
- [quote-item-card](components/quote-item-card/) — `.qcard__*` flip card driven by `moodForQuote(q)`.
- [quote-action-buttons](components/quote-action-buttons/) — `.qbtn--nudge` / `.qbtn--view` pills.

## Notable interactions
- The `<Track>` component is the same as in Invoices (`.qtrack__*`).
- Mood gradient on each card varies with stage:
  - `opened` → green (engagement signal).
  - `sent` → coffee.
  - `cooling`/`stale` → pink (escalating urgency).
  - `won` → green; `lost` → muted red.
- The right rail (`.qside`) is `position: sticky; top: 16px`.

## Source
`extracted/Paperwork Monsters Quotes.html` (also at `pages/quotes/raw.html`).
