/* SOURCE POINTER — the four `aside.qside` widgets live verbatim in:
 *   ../../payments-page/js/PaymentsPage.tsx
 *     · PSideFlow       lines 805–881  (12-week cash-flow sparkline, SVG)
 *     · PSideTopPayors  lines 883–927  (top-4 payors bar list)
 *     · PSideMix        lines 929–1005 (method-mix stacked bar + legend)
 *     · PSideTip        lines 1007–1028(static "Monster tip" teal card)
 *
 * DATA-SHAPE HAZARD (flagged): all four are recomputed client-side over the
 * full `landed` array on every render — a per-render rollup over jobs/payments
 * (PSideTopPayors tallies by client, PSideMix by method, PSideFlow buckets
 * amounts into 12 fake weeks by index, NOT by receivedAt). See
 * payment-side-rail.md §1.
 *
 * CSS HAZARD (flagged): PSideTopPayors uses `.qside__rows/.qside__row/
 * .qside__rank/.qside__row-body/.qside__row-name/.qside__bar/.qside__bar-fill/
 * .qside__row-amt` — NONE of these are defined in any static/*.css. They
 * render UNSTYLED (the inline width/background on the bar-fill is the only
 * styling that lands). QuotesPage's equivalent rail uses the *styled*
 * `.qbig*`/`.qbar*` classes instead. See payment-side-rail.md §1/§6. */
export {};
