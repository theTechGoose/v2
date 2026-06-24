# Page — /payments

Editorial "money landed" view of recorded payments. **MANUAL-ONLY**: payments
are *recorded*, never processed in-app (no card/merchant flow). The page reuses
the Quotes card/track/layout classes and adds its own `.pph*` hero from
`payments.css`. The whole interactive surface is one client island.

## Purpose
Celebrate received money. A big "$X showed up this month" hero with a fanned
stack of recent-payment stubs, a 4-cell KPI strip, a "Just landed" track of
payment flip cards + a compact tail-of-month list, an optional "In transit"
track (ACH/check still inside their settlement window), and a right rail of
analytics widgets (cash-flow sparkline, top payors, method mix, a tip).

## App-shell composition (order)
Route file: `routes/payments/index.tsx` (copied to `js/index.tsx`). A
`define.page` SSR route (not an island), same shape as /invoices:

```
<Head> … </Head>
<div class="app">
  <DashSidebar active="payments" />        ← SHARED (shared-components/dash-sidebar)
  <main class="main">
    <DashTopbar greetingDate greetingName/> ← SHARED (shared-components/dash-topbar)
    <div class="content">
      <PaymentsPage />                      ← THE island (components/payments-page)
    </div>
  </main>
</div>
```

Order: Sidebar, then main → Topbar → content → PaymentsPage.

## `<Head>` — title + CSS
- `<title>` = `tFor(lang, "paymentsRoute.docTitle")`.
- Stylesheets (keys, in order): `css-dashboard` → `/dashboard.css`,
  `css-quotes` → `/quotes.css`, `css-payments` → `/payments.css`.
- `/payments.css` supplies the `.pph*` editorial hero + `.pcard__amount`; all
  other `.q*` classes come from quotes.css; tokens + shell from dashboard.css.
  See `../../design-tokens.md`.

## SSR data
Route SSRs only `user.language` (→ doc title + greeting) + greeting date. **No
payment data is server-rendered.** The island fetches everything on mount
(payments + invoices + customers). First paint = Skeletons.

## Sections (top → bottom)
1. **PaymentsHero** (`.pph`) — eyebrow (Payments · {month}), amount headline
   (or a "fresh" empty variant), sub, two assistant-seeded CTAs, and the
   `.pph__stack` of up to 3 rotated recent-payment stubs.
   → `components/payments-hero`.
2. **PaymentsKpis** (`.qkpi`) — Landed this month / In transit (accent) /
   Needs attention / Avg days to pay. → `components/payments-kpis`.
3. **`.qlay` → two columns**:
   - **main column** — QuoteTrack sections (SHARED — `shared-components/
     quote-track`):
     - (conditional) "Needs attention" track — only if `attention.length>0`
       (always 0 today; the schema carries no declined/returned status).
     - "Just landed" track (defaultOpen) — a `.qcards` grid of **PaymentCard**
       flip cards for ≤1-day-old payments, then a `.qdone` list of
       **LandedRow** for older landed payments. Honest-empty hint when both 0.
     - (conditional) "In transit" track — only if `transit.length>0`
       (ACH <2d / check <5d still settling). defaultOpen=false.
     - **Track numbering is dynamic**: "01"/"02"/"03" shift depending on
       whether the attention track is present.
   - **`aside.qside`** (sticky, 320px) — 4 widgets:
     PSideFlow (sparkline) · PSideTopPayors · PSideMix · PSideTip.
     → `components/payment-side-rail`.

## Build order
1. Tokens + quotes.css + payments.css.
2. Shell (DashSidebar/DashTopbar) + Skeletons + QuoteTrack.
3. `EnrichedPayment` derivation + `deriveStatus` (settlement windows).
4. PaymentsHero (incl. fresh variant + stub stack) → PaymentsKpis.
5. PaymentCard flip card; LandedRow; the conditional tracks.
6. Side rail widgets.

## Status taxonomy (derived, not stored)
The backend `Payment` model carries no status. The island derives:
- **landed** — settled (instant methods, or aged past the settlement window).
- **transit** — ACH/check still inside `SETTLE_DAYS` (ach 2, check 5).
- **attention** — RESERVED for future declined/returned; always empty today,
  so its track + KPI render but show 0, and the track hides itself.

## Honest-empty
- Fresh month (monthTotal/transitTotal/attentionCount all 0): hero shows a
  "fresh start" variant; Landed track shows the `landedEmpty` hint; each side
  widget shows its own empty copy (PSideFlow `flow.empty`, PSideTopPayors
  `payors.empty`, PSideMix `mix.empty`).

## Data-shape hazards (flagged)
- **Payment-sum rollups over jobs are recomputed client-side every render**:
  `monthTotal`, `transitTotal`, `avgDays`, AND all four side widgets
  (PSideTopPayors tallies by client, PSideMix by method, PSideFlow buckets by
  index). The dashboard equivalents (`payments.methodMixCents`, `topPayors`,
  `revenue.sparkline12mo`) are whole-account Σ-over-all-payments rollups — see
  `../../data-model.md` §5.1. **[denormalize / precompute; don't scan].**
- **PSideFlow buckets amounts by array index, NOT by `receivedAt`** — the
  "12-week cash-flow shape" is fabricated from order, not real dates (the
  source comment admits it). The Feb/Mar/Apr axis labels are hardcoded.

## Anti-patterns
- Whole-page island, fetch-on-mount, frozen SSR props (only `lang`).
- **Undefined CSS classes** in PSideTopPayors + LandedRow render unstyled —
  see payment-side-rail.md / landed-row.md §6. (Real visible bug.)
- PaymentCard's CTA + all three back-foot buttons are **no-ops**
  (`e.stopPropagation()` only) — see payment-card.md.
