# Capture checklist — InvoicesPage

**Theme:** light only (single theme — no dark mode exists).
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/invoices` (the whole page island — sidebar + topbar +
  hero + KPI strip + the 6 tracks all in one shot).

## Viewports (from quotes.css `@media`)
- **1280px** — desktop. NOTE the `.qlay` grid is `1fr 320px` but the invoices
  island renders no right rail, so capture the empty 320px gutter on the right.
- **980px** — still 2-col KPIs (the KPI cut is at ≤1200, not 980); confirm hero
  is still inline at this width (hero stacks at ≤1200).
- **1200px** boundary — at ≤1200 `.qlay`→1col, `.qph`→column-stacked, `.qkpi`→2×2.
- **720px** — `.qcards`→1col, `.qkpi`→1col (the ≤768 block), sidebar→drawer
  (DashSidebar shared behavior).

## Element(s) to crop
- Full page (hero → KPIs → tracks) at 1280 and 720.
- The hero alone (its 5 headline variants) — see invoices-hero checklist.
- The KPI strip alone (4 cells, Overdue accent) — see invoices-kpis checklist.
- One expanded track with cards + one collapsed track (QuoteTrack[shared]).

## Transient states to drive
1. **loading** — hard-reload `/invoices`; capture the skeleton frame
   (ShimmerStyle + PageHeaderSkeleton + CardGridSkeleton rows=2) before data
   lands. May need network throttling to catch it.
2. **populated** — the seeded/real pipeline: overdue, awaiting-confirmation,
   out, upcoming, drafting, paid tracks each with cards.
3. **empty** — a fresh account (0 invoices) → empty hero + all 6 EmptyTrack
   hints + $0 KPIs.
4. **new-invoice modal open** — click the hero **New invoice** CTA
   (`button[data-cy=invoice-new]`); capture the overlay open over the page
   (scrim + centered form). See new-invoice-modal checklist for its variants.
5. **error** — force a `/invoices` failure (the .qpage-error UNSTYLED branch);
   document that it renders as plain unstyled body text (hazard).

## Motion to film
- Page-level motion is all from children: skeleton shimmer (shared Skeletons),
  track collapse (QuoteTrack: chevron 240ms bounce + body grid-rows 320ms), card
  flip + hover-lift + pulsing status dot (InvoiceCard). Film a card flip and a
  track collapse here in context. Re-shoot one with
  `prefers-reduced-motion: reduce` (relies on the global tokens clamp — verify
  the flip/collapse/shimmer all still).

## Notes
- NO fabricated screenshots — capture only against the live app at the widths
  above. The right-rail empty gutter at ≥1201px is real; document it, don't crop
  it out.
