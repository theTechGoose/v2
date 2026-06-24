# InvoicesKpis

The 4-cell `.qkpi` summary strip below the hero on /invoices: **Overdue** (pink
accent when count > 0) · **Out for payment** · **Drafting** · **Paid this
month**. Pure presentational — every value is a prop computed by the parent
island.

## 1. Classification & behavior
- **Bucket:** local presentational component of the InvoicesPage island
  (`islands/InvoicesPage.tsx` lines 728–792). Not its own island — it renders
  inside the page island's hydration boundary.
- **Interaction tier:** **static / island-child.** No client state, no events,
  no callbacks. It only reads props + `tFor(lang, …)`.
- **Server actions + flash:** none. It is a read-only KPI display.
- **Island client-state + refresh:** none of its own. When the page island
  re-fetches (today via a child's `location.reload()`), the parent recomputes
  the seven numbers and re-renders this strip with fresh props. **No
  `location.reload()` lives here** — flag belongs to InvoiceCard /
  NewInvoiceModal.
- **Data source + honest-empty:** all data flows down as props — there is no
  fetch here. The numbers are derived in the island from `GET /invoices`
  (`dashboardClient.invoices`): `overdueCount`/`overdueTotal`,
  `outCount`/`outTotal`, `draftingCount`, `paidCount`/`paidTotal` come from the
  six `filter/sort` buckets over the enriched invoice list. **Honest-empty:**
  with zero invoices every cell renders truthfully — `fmtMoney(0)` → `"$0"`,
  counts → `0`, and the Drafting sub flips to `"no drafts open"`
  (`invoicesPage.kpi.draftingSubEmpty`) instead of `"finish + send"`.
- **Liveness / polling:** none. Frozen until the parent re-renders.
- **Data-shape hazards (invoice aging/urgency buckets):**
  - The **Overdue** total/count is the parent's **client-derived** aging
    bucket (`enrich()` recomputes `daysOverdue` from `dueDate < today`), NOT the
    DTO's own `urgency` field — see invoices-page.md §1 / data-model.md hazard
    #8. So this KPI can disagree with a server-computed aging bucket.
  - **Out** = the parent's `stage==="out"` bucket only (it excludes claimed +
    scheduled). The KPI strip shows only 4 of the island's 6 tracks, so the
    Out-for-payment total here is NOT "everything not paid" — claimed,
    scheduled, and overdue dollars are counted separately / not at all in this
    strip.
  - Money props are **integer CENTS** (`overdueTotal`/`outTotal`/`paidTotal`),
    formatted by `fmtMoney` (no-cents, rounded). `draftingCount` is a bare
    integer rendered as the value itself (no money format) — the only cell whose
    `.qkpi__val` is a count, not a dollar amount.

## 2. Anatomy
```
<div class="qkpi">
  <div class="qkpi__cell [qkpi__cell--accent]">        ← --accent only when overdueCount>0
    <div class="qkpi__lbl">{status.overdue → "Overdue"}</div>
    <div class="qkpi__val">{fmtMoney(overdueTotal)}</div>
    <div class="qkpi__sub">{overdueCount} {invoice|invoices}</div>
  </div>
  <div class="qkpi__cell">                              ← Out for payment
    <div class="qkpi__lbl">{kpi.out → "Out for payment"}</div>
    <div class="qkpi__val">{fmtMoney(outTotal)}</div>
    <div class="qkpi__sub">{kpi.outSub → "{n} on the way"}</div>
  </div>
  <div class="qkpi__cell">                              ← Drafting (count value, not $)
    <div class="qkpi__lbl">{kpi.drafting → "Drafting"}</div>
    <div class="qkpi__val">{draftingCount}</div>
    <div class="qkpi__sub">{draftingSub | draftingSubEmpty}</div>
  </div>
  <div class="qkpi__cell">                              ← Paid this month
    <div class="qkpi__lbl">{kpi.paid → "Paid this month"}</div>
    <div class="qkpi__val">{fmtMoney(paidTotal)}</div>
    <div class="qkpi__sub">{kpi.paidSub → "{n} cleared"}</div>
  </div>
</div>
```
- No slots/children. No icon dependency. The accent class is the only
  conditional. Cells 1/2/4 show money; cell 3 (Drafting) shows a raw count.

## 3. Props
| name | type | default | widget | signal? |
|---|---|---|---|---|
| `overdueCount` | number | — | number | no |
| `overdueTotal` | number (cents) | — | number | no |
| `outCount` | number | — | number | no |
| `outTotal` | number (cents) | — | number | no |
| `draftingCount` | number | — | number | no |
| `paidCount` | number | — | number | no |
| `paidTotal` | number (cents) | — | number | no |
| `lang` | `Lang` | — | select | no |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| default | all four cells with realistic numbers; Overdue accent ON | `cases/default/default.json` |
| no-overdue | `overdueCount=0` → Overdue cell loses `--accent` (plain white) | `cases/no-overdue/no-overdue.json` |
| empty | every count/total 0 → "$0", "0 invoices", "no drafts open" | `cases/empty/empty.json` |
| es | Spanish labels/units | `cases/es/es.json` |

## 5. Events
- None. `capture(page)` finds no interactive elements in this component (no
  buttons, links, or inputs). It is display-only.

## 6. Motion
- **None of its own** — no keyframes, no transitions on `.qkpi*`. The `--accent`
  cell is a static pink gradient (no animation). Reduced-motion is moot here
  (nothing animates); the global tokens clamp still applies app-wide.

## 7. Responsive (own `@media`, from quotes.css)
- Base: `.qkpi` is `grid-template-columns: repeat(4, 1fr)` (4 across).
- `≤1200px`: `.qkpi` → `repeat(2, 1fr)` (2×2).
- `≤768px`: `.qkpi` → `1fr` (single column stack).
- Verify at **1280px**, **980px** (still 2-col since the cut is 1200), **720px**
  (1-col) against quotes.css.

## 8. A11y
- Plain `<div>` grid of `<div>`s — no list/table semantics, no headings. Each
  cell is label → value → sub with no programmatic association (a screen reader
  reads three loose strings per cell). **Fix on rebuild:** use a `<dl>`
  (`<dt>` label / `<dd>` value) per KPI, or `role="group"` + `aria-label`.
- The Overdue accent communicates urgency with **color only** (pink gradient) —
  the count text carries the real signal, so it degrades acceptably, but add a
  non-color cue if it becomes the sole indicator.

## 9. Used on
`/invoices` only (rendered once by InvoicesPage between the hero and the
tracks). Reuses the Quotes `.qkpi*` CSS verbatim from `static/quotes.css` — see
`css/invoices-kpis.css`. (The Quotes and Payments pages render their own `.qkpi`
strips with different copy; this one is the invoices variant.)
