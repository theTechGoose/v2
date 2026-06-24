# Page — /invoices

Receivables view. Despite the URL, the page **reuses the Quotes code path**:
same `.qph/.qkpi/.qtrack/.qcard/.qcards/.qlay` classes (loaded from
`quotes.css`), with the copy + stage moods swapped for invoice semantics. The
whole interactive surface is a single client island.

## Purpose
Show the contractor every receivable, bucketed by lifecycle stage, with a
forecast headline ("$X expected this week"), a 4-cell KPI strip, and per-invoice
flip cards that expose the mutation actions (send / nudge / confirm-received /
finish-draft / mute / discount / change-order). Plus a "New invoice" modal for
standalone (no-contract) invoices.

## App-shell composition (order)
Route file: `routes/invoices/index.tsx` (copied to `js/index.tsx`). It is a
`define.page` SSR route — NOT an island — that resolves `ctx.state.user`, builds
a localized greeting, and renders:

```
<Head> … </Head>
<div class="app">                         ← app-shell grid (dashboard.css)
  <DashSidebar active="invoices" />       ← SHARED island (shared-components/dash-sidebar)
  <main class="main">
    <DashTopbar greetingDate greetingName/>← SHARED island (shared-components/dash-topbar)
    <div class="content">
      <InvoicesPage />                    ← THE island (components/invoices-page)
    </div>
  </main>
</div>
```

Order: Sidebar, then main → Topbar → content → InvoicesPage.

## `<Head>` — title + CSS
- `<title>` = `tFor(lang, "invoicesPage.docTitle")`.
- Stylesheets (keys): `css-dashboard` → `/dashboard.css`, `css-quotes` →
  `/quotes.css`. **There is NO `/invoices.css`** and the page does **not** load
  `/payments.css`. (Contrast: /payments loads all three + payments.css.)
- Tokens + the `.app/.main/.content` shell come from dashboard.css; every
  `.q*` class comes from quotes.css. See `../../design-tokens.md`.

## SSR data
The route SSRs **only** `user.language` (→ doc title + greeting) and the
greeting date. **No invoice data is server-rendered.** All invoice/customer/
forecast data is fetched client-side by the island on mount (see
`components/invoices-page/invoices-page.md`). First paint = Skeletons.

## Sections (top → bottom, inside `.content`)
1. **InvoicesHero** (`.qph`) — forecast/outstanding headline + sub + at-risk
   line + CTA row (New invoice button, Export-CSV link). 5 headline variants.
   → `components/invoices-hero`.
2. **NewInvoiceModal** — conditional overlay when the hero's New button is
   clicked. → `components/new-invoice-modal`.
3. **InvoicesKpis** (`.qkpi`) — Overdue / Out / Drafting / Paid-this-month.
   → `components/invoices-kpis`.
4. **`.qlay` → single column** of SIX collapsible **QuoteTrack** sections
   (SHARED — `shared-components/quote-track`), each filled with a `.qcards` grid
   of **InvoiceCard** flip cards (or an `EmptyTrack` hint):
   - `01` Overdue · needs a poke (defaultOpen, sorted daysOverdue desc)
   - `02` Awaiting confirmation (defaultOpen, sorted claimedAt desc) — the
     claim→confirm bucket
   - `03` Out for payment (defaultOpen, sorted daysIn desc)
   - `04` Upcoming (defaultOpen=false, scheduled invoices, sorted scheduledFor)
   - `05` Drafting (defaultOpen=false)
   - `06` Paid this month (defaultOpen=false)
   → cards in `components/invoice-card`.

> Note: the island file's top comment lists 4 tracks; the live code renders 6
> (it grew). The `.qlay` second (320px) track is empty on /invoices — no
> `aside.qside` is rendered, so the rail column collapses.

## Build order
1. Confirm tokens (dashboard.css) + quotes.css `.q*` classes exist.
2. Mount the SHARED app-shell (DashSidebar/DashTopbar) + Skeletons + QuoteTrack.
3. Build `EnrichedInvoice` derivation + stage bucketing (island).
4. InvoicesHero (5 variants) → InvoicesKpis → the 6 QuoteTracks.
5. InvoiceCard flip card (front + back + adjust panel + all mutations).
6. NewInvoiceModal.

## Honest-empty
- Truly-empty (0 invoices): hero shows the empty headline; KPIs all $0/0;
  every track shows its `EmptyTrack` hint.
- Each track independently renders `EmptyTrack` when its bucket is empty.

## Data-shape hazards (flagged)
- **Aging / urgency bucketing is recomputed client-side every render** over the
  whole invoice list (`enrich()` → `daysOverdue`/`daysIn`/`stage`, then 6
  `.filter().sort()` passes). On a real backend the per-invoice `urgency` and
  the dashboard `agingBuckets` are date-derived scans over all open invoices —
  see `../../data-model.md` §5.8. **[bucket on write / scheduled recompute].**
- The `/api/invoices/forecast/this-week` call is fire-and-forget and silently
  falls back to the legacy outstanding-total headline on 404.

## Anti-patterns (see invoice-card.md / new-invoice-modal.md for fixes)
- The page is a **whole-page island** that fetches on mount with frozen SSR
  props (only `lang`). Every mutation in InvoiceCard + the modal ends in
  `globalThis.location.reload()` — a full-page reload instead of a local
  re-fetch/PRG. Flagged per-component.
