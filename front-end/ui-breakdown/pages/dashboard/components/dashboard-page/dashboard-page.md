# DashboardPage

The top-level **data island** for `/dashboard`. The SSR route renders an empty
shell; this island hydrates, fans out the dashboard fetches in parallel, maps
the DTOs to presentational rows, and assembles the page body (assistant banner,
setup checklist, KPIs, jobs/quotes grid, activity/money grid).

## 1. Classification & behavior
- **Bucket:** `island` (file lives in `islands/DashboardPage.tsx`). 554 lines.
- **Interaction tier:** `island` — client-only state via `useState`; renders
  nothing interactive that mutates the server. All real interactivity is `<a
  href>` navigation + the (currently inert) nudge buttons inside DashSections.
- **Client state owned (`useState<State>`):**
  `{ loading, error, stats, jobs, quoteCards, pendingInvoices, customers,
  notifications }`. Seeded on mount from `readCached()` — if a `stats` snapshot
  already exists in the shared dash-cache, the initial state is
  `{ ...INITIAL, loading:false, stats:c.stats }` so the hero + KPIs paint
  instantly (warm start); otherwise `INITIAL` (loading skeleton).
- **Reactive language:** reads `langSignal.value` at render → re-renders live
  when Settings flips language. The legacy `lang?` prop is ignored.
- **Data source per region (all client-fetched on mount, `useEffect([])`):**
  - KPIs / Money-owed / Outstanding totals ← `DashboardStats`
    (`dashboardClient.stats()` → `/analytics/dashboard`). The whole-account
    rollup — see DATA-SHAPE HAZARD below.
  - Active jobs rows ← `Job[]` (`dashboardClient.jobs()` → `/jobs`), sliced to 5.
  - Quotes-awaiting rows ← `QuoteCard[]`
    (`quotesClient.list("sent")` → `/quotes?status=sent`), de-duped + sorted by
    `sentAt` desc, sliced to 4.
  - Outstanding rows ← `Invoice[]`
    (`dashboardClient.invoices("pending")`), sorted by `dueDate` asc, sliced 5;
    client names joined from `customers`.
  - Activity rows ← `Notification[]` (`dashboardClient.notifications(10)`),
    consecutive-duplicate-title-collapsed (`· N×`), sliced to 4.
  - `customers` ← `dashboardClient.customers()` (only for the
    `customerId→name` map used by Outstanding).
  - Each fetch is individually `.catch()`-guarded to a safe empty
    default, so a single endpoint failing degrades that region, not the page.
  - It ALSO calls `refreshDash()` (fire-and-forget) to keep the shared cache
    warm for sibling islands (sidebar badges).
- **Honest-empty:** every section degrades honestly (see DashSections spec):
  ActiveJobs shows an empty CTA, QuotesAwaiting a one-liner, Outstanding "all
  paid / no invoices", Activity an empty sub. `pickKpis` clamps Outstanding to
  exactly `$0` when `invoices.pending === 0` (avoids a nonsense `$0.09 · 0
  invoices` from stray aging-bucket cents).
- **Server mutations:** NONE in this island. (The nudge buttons in DashSections
  are inert `<button type=button>` with no handler.)
- **Liveness:** request-response, fetch-once-on-mount. No polling, no
  websocket, no `setInterval`. The Ticker count-up is the only timed animation.
- **`location.reload()`:** NONE. ✅ (Anti-pattern check passed.)
- **Data-shape hazards:**
  - `pickKpis` reads deep into `stats.invoices.agingBuckets.*` and
    `stats.revenue.sparkline12mo` with `?? 0` fallbacks — tolerant of a partial
    `DashboardStats`. Money fields are **cents**, divided by 100 here.
  - `Array.isArray(...)` guards around `jobs`/`quoteCards`/`pendingInvoices`
    before slicing — defends a non-array payload.
  - `clientFromSummary` parses a client name out of a quote summary
    (`/—\s*(.+)$/`) only when `q.customerName` is null — fragile string parse.
  - Activity HTML is server-derived + `escapeHtml`'d, then injected via
    `dangerouslySetInnerHTML` in the `Activity` section (the `· N×` dupe badge
    is appended as trusted markup).

## 2. Anatomy
```
loading → <DashboardSkeleton/>      (ShimmerStyle + SkelBlocks shaped like the real layout)
error   → <div class="dashpage-error">{loadError}: {msg}</div>   ← UNSTYLED
else:
<>
  <div class="assistant-cta">                       ← green→teal gradient banner
    <div class="assistant-cta__body">
      eyebrow / title / sub
      <div class="assistant-cta__actions">
        <a.assistant-cta__btn href="/assistant">    crown + "My Assistant" + arrow
        <a.assistant-cta__call href="tel:+18667678399">  phone + "Call support" + (866) 767-8399
    <div class="assistant-cta__art">                ← 3 confetti + blob + monster img
  <SetupChecklist/>                                 ← page-local island
  <Kpis .../>                                       ← DashSections
  <div class="grid"><ActiveJobs/><QuotesAwaiting/></div>
  <div class="grid"><Activity/><Outstanding/></div>
</>
```
- **Support line:** `SUPPORT_PHONE = "+18667678399"` /
  `SUPPORT_PHONE_DISPLAY = "(866) 767-8399"` — the toll-free 866 that forwards
  to the owner cell via a Twilio Studio Flow. Public, safe to ship.
- **Icon dependency:** `lib/dash-icons.tsx` (`I` renderer + `ICN` map). Uses
  `crown`, `arrow`, `phone` directly; section icons (`hardhat/wrench/truck/
  paint/ruler/send/check/contract/card/invoice/msg/sparkle/quote/trend/eye`)
  flow through DashSections. (Already copied into the shared dash-sidebar spec
  at `shared-components/dash-sidebar/js/dash-icons.tsx`.)

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `lang` | `"en"\|"es"` | `undefined` (IGNORED) | — | superseded by `langSignal` |

The island takes **no functional props** — the route mounts it bare
(`<DashboardPage />`). The `lang` prop is a vestigial SSR seed; the live value
is `langSignal.value`.

## 4. States → cases
Because all display data is client-fetched, isolate models it via `_mocks`
(the client responses) rather than props. The `lang` reactive value is set via
`_signals`.

| state | meaning | case |
|---|---|---|
| populated | seeded account; all sections filled | `cases/populated/populated.json` |
| loading | cold cache, fetches in flight → DashboardSkeleton | `cases/loading/loading.json` |
| warm-start | dash-cache hit → hero+KPIs paint, no skeleton | `cases/warm-start/warm-start.json` |
| empty | brand-new account; honest-empty everywhere | `cases/empty/empty.json` |
| error | all fetches reject → `.dashpage-error` | `cases/error/error.json` |

## 5. Events
- `ev.expect(e => e.source === "a.assistant-cta__btn" && e.type === "click")` →
  nav `/assistant`.
- `ev.expect(e => e.source === "a.assistant-cta__call" && e.type === "click")` →
  `tel:+18667678399` (dials; on desktop opens the OS handler).
- All other clicks bubble to DashSections children (See-all links, nudge
  buttons) — modeled in `dash-sections` Events.
- No emitted custom events; no form submit.

## 6. Motion (extracted)
- `.assistant-cta:hover` → `translateY(-2px)` + shadow grow over **220ms**
  `cubic-bezier(.34,1.56,.64,1)`; the inner `.assistant-cta__btn` nudges
  `translateX(2px)` + `brightness(1.05)` (180ms bounce).
- KPI tiles + everything else: see DashSections / Ticker specs.
- **Skeleton shimmer:** `pmShimmer` 1.4s linear infinite (from shared
  Skeletons) while `loading`.
- **Jank finding:** the assistant-cta hover animates `transform` (compositor-
  friendly) + `box-shadow` (paint). The shadow change forces a repaint of the
  large banner each frame on hover — acceptable (hover, not scroll), but on
  low-end devices prefer animating an opacity-layered pseudo-shadow.
- **Reduced motion:** no island-local guard; the global tokens `@media` clamps
  the hover transition to `0.01ms`.

## 7. Responsive (own @media widths)
- The island has no `@media` of its own — it relies on `dashboard.css`:
  `.assistant-cta` restacks at **720px**; `.grid`→1-col and `.kpis`→2-up at
  **640px**; shell flex→body-scroll at **640/641px**. See css/dashboard-page.css.

## 8. A11y
- The assistant banner is two real `<a>` links — keyboard-operable, native
  semantics. Icons inside are decorative SVG.
- Skeleton blocks are decorative (no `aria-busy` on the region — gap; consider
  `aria-busy="true"` on `.content` while loading).
- The error branch renders an unstyled, un-roled `<div>` — not announced to SR
  (gap; add `role="alert"`).
- Section-level a11y lives in DashSections / SetupChecklist.

## 9. Used on
**`/dashboard` only.** Single import: `routes/dashboard/index.tsx`. Not shared.
