# InvoicesPage

The /invoices island. Orchestrates the whole receivables surface: fetch →
enrich → bucket → render hero/KPIs/6 tracks. 1632 lines; the large sub-pieces
(InvoiceCard, NewInvoiceModal) have their own folders.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/InvoicesPage.tsx`).
- **Interaction tier:** **whole-page island, client-only state.** Self-fetches
  on mount; SSR seeds nothing (the `lang` prop is an ignored SSR seed — the
  island reads `langSignal.value` instead so it re-renders live on a language
  flip).
- **Client state owned:**
  - `s: State { loading, error, invoices, customers }` — the fetched data.
  - `forecast?: ForecastResult` — separate fire-and-forget fetch.
  - `newOpen: boolean` — NewInvoiceModal visibility.
- **Server actions + flash:** none at the page level. All mutations live in
  child InvoiceCard / NewInvoiceModal (each does `fetch` → `location.reload()`).
- **Data source per region:**
  - invoices ← `dashboardClient.invoices(undefined)` (`GET /invoices`), `.catch
    → []`.
  - customers ← `dashboardClient.customers()` (`GET /customers`), `.catch → []`.
  - forecast ← `fetch("/api/invoices/forecast/this-week")`, ok→json else
    `undefined` (silent legacy fallback).
  - All three fire in parallel `useEffect([])`; an `alive` flag guards unmount.
- **Honest-empty:** `loading` → Skeletons (ShimmerStyle + PageHeaderSkeleton +
  CardGridSkeleton rows=2 — all SHARED); `error` → `.qpage-error` div (an
  UNSTYLED class — renders as default text, see §7); else the hero/KPIs render
  with $0/0 and every track shows its `EmptyTrack` hint.
- **Liveness:** request-response only; no polling/websocket. State refreshes
  via child `location.reload()` (full page) — flagged below.
- **Data-shape hazards:**
  - **Invoice aging/urgency buckets are derived client-side** (`enrich()` +
    six `filter/sort` passes) every render. The DTO's own `urgency` field
    (`{label,tone,daysOverdue}`) is **ignored** — the island recomputes
    `daysOverdue`/`daysIn`/`stage` from `dueDate`/`issuedDate`/`status`/`paidAt`
    itself. So two notions of "overdue" can disagree. **[bucket on write].**
  - `isDraft()` is deliberately broad (catches "draft"/"drafting"/"drafted",
    no-status+no-issuedDate, pending+no-issuedDate) — backend `status` is an
    open string.
  - `customers` is `Array.isArray`-guarded in three places because the catch
    returns `[]` but a malformed payload could be non-array.
- **Anti-patterns:**
  - Whole-page island with frozen SSR props (only `lang`); all data client-
    fetched on mount. **Fix:** SSR the invoice list in the route loader and
    hand it to the island as a hydration seed (eliminates the skeleton flash +
    the empty-on-first-paint).
  - Child mutations call **`location.reload()`** (FLAG) — see invoice-card.md /
    new-invoice-modal.md. **Fix:** lift a refetch callback into the island and
    re-pull `/invoices` instead of reloading the page.

## 2. Anatomy
```
<> (fragment, inside .content)
  <InvoicesHero …/>                         ← .qph
  {newOpen && <NewInvoiceModal …/>}         ← fixed overlay
  <InvoicesKpis …/>                         ← .qkpi
  <div class="qlay"><div>                    ← single column (2nd track empty)
    <QuoteTrack 01 Overdue>      … InvoiceCard[] | EmptyTrack
    <QuoteTrack 02 Awaiting>     … (data-cy="awaiting-confirmation-track")
    <QuoteTrack 03 Out>          …
    <QuoteTrack 04 Upcoming>     … (data-cy="upcoming-track", defaultOpen=false)
    <QuoteTrack 05 Drafting>     … (defaultOpen=false)
    <QuoteTrack 06 Paid month>   … (defaultOpen=false)
  </div></div>
</>
```
- Local helper components: `InvoicesHero`, `InvoicesKpis`, `EmptyTrack`,
  `InvoiceCard`, `NewInvoiceModal`.
- Helpers: `methodLabel`, `shortDay`, `monthLabel`, `fmtDate`, `initialsOf`,
  `isDraft`, `enrich`, `STAGE_MOOD`.
- Deps: QuoteTrack[shared], Skeletons[shared], `I`/`ICN`[dash-icons],
  `fmtMoney`/`fmtMoneyExact`, `tFor`/`langSignal`, dashboardClient/clientsClient.

## 3. Props
| name | type | default | widget | signal? |
|---|---|---|---|---|
| `lang` | `Lang` | (ignored SSR seed) | — | reads `langSignal.value` instead |

(No other props — it is the page island.)

## 4. States → cases
| state | meaning | case |
|---|---|---|
| loading | Skeletons | `isolate/cases/loading/loading.json` |
| error | `.qpage-error` text | `isolate/cases/error/error.json` |
| empty | 0 invoices → empty hero + all tracks empty | `isolate/cases/empty/empty.json` |
| populated | full pipeline across stages | `isolate/cases/populated/populated.json` |

## 5. Events
- `ev.expect(e => e.source==="button.qph__cta[data-cy=invoice-new]" &&
  e.type==="click")` → sets `newOpen=true` (mounts NewInvoiceModal).
- Track collapse events belong to QuoteTrack[shared].
- Card flip / mutation events belong to InvoiceCard.

## 6. Motion
- None of its own. Skeleton shimmer = SHARED Skeletons; track collapse =
  QuoteTrack; card flip = InvoiceCard. Reduced-motion via the global tokens
  clamp.

## 7. Responsive (own `@media`, from quotes.css)
- `≤1200px`: `.qlay` → 1 col; `.qph` stacks; `.qkpi` → 2 cols.
- `≤768px`: `.qcards` → 1 col; `.qkpi` → 1 col.

## 8. A11y
- `.qpage-error` has no `role="alert"` and no styling (UNSTYLED class — no CSS
  rule exists anywhere). **Fix:** add a styled error region + `role="alert"`.
- Loading state is silent (no `aria-busy`).

## 9. Used on
`/invoices` only (mounted by `routes/invoices/index.tsx`).
