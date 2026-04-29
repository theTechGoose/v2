# Invoices

## Purpose
The receivables view: every invoice the user has out, segmented by stage. Surfaces what's overdue, what's en route, what's still in draft, and what's paid this month — with one-tap nudge actions. Despite the URL/title saying "Invoices", the React component names are `Quote*` because Quotes/Invoices share the same code path with copy and stage names swapped.

## Top-level structure
Standard `.stage` → `.window` → `.app` → `.main`. Inside `.content`:

1. **`<QuotesHero>`** — `.qph` editorial header ("The river of money").
2. **`<QuotesKpis>`** — `.qkpi` 4-cell breakdown (Overdue / Out for payment / Drafts / Paid this month).
3. **`.qlay`** layout wrapper:
   - Main column: 4 collapsible `<Track>` (`.qtrack__*`) sections. Each renders `.qcards` of `<QuoteCard>` items.
     - `01 Overdue · needs a poke` — sorted by daysOverdue desc.
     - `02 Out for payment` — sorted by daysIn desc.
     - `03 Drafting` — `defaultOpen={false}`.
     - `04 Paid this month` — `defaultOpen={false}`.
   - The right rail (when present in some layouts) is implicit; this page doesn't render a side panel by default.

## Layout chrome (uses `shared/`)
- `shared/sidebar`, `shared/topbar`, `shared/annotation-dots`, `shared/phone-preview`.
- The `.qph` header is page-unique (not the dashboard `.hero`).

## Page-unique components
- [invoice-page-header](components/invoice-page-header/) — `.qph__*` editorial header.
- [invoice-kpi](components/invoice-kpi/) — `.qkpi__*` 4-cell metric grid (`--accent` variant for the overdue cell).
- [invoice-track](components/invoice-track/) — `.qtrack__*` collapsible section (same pattern as `contract-track`).
- [invoice-item](components/invoice-item/) — `.quote-item__*` row used in side-panel lists ("Quotes awaiting" pattern). The page mostly uses `.qcard` cards (extracted under Quotes).
- [invoice-action-buttons](components/invoice-action-buttons/) — `.qbtn__*` nudge / view buttons.

## Notable interactions
- Tracks collapse/expand via `useState` driven `.qtrack--collapsed` (same grid-template-rows trick as `ktrack`).
- `moodForQuote(q)` returns gradient stops based on stage + days overdue. Deep-red for >14d overdue, pink for fresh overdue, teal for "out", green for paid, brown for drafts.

## Source
`extracted/Paperwork Monsters Invoices.html` (also at `pages/invoices/raw.html`).
