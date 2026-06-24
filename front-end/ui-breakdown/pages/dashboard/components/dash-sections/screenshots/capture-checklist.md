# Capture checklist — DashSections

**Theme:** light only.
**Auth:** log in with dev master OTP `000000` (any seeded phone).
**Route:** `http://localhost:5280/dashboard`. These blocks are the lower half of
the dashboard body (below the `.assistant-cta` banner + SetupChecklist), composed
by `DashboardPage`. No standalone route — capture in place on `/dashboard`.

## Element(s) to crop
- **Kpis** — the `.kpis` row (4 tiles).
- **ActiveJobs** — the left `.panel` in the first `.grid`.
- **QuotesAwaiting** — the right `.panel` in the first `.grid`.
- **Activity** — the left `.panel` (`#activity`) in the second `.grid`.
- **Outstanding** — the right `.money` card in the second `.grid` (gradient).
- Also one full-width crop of each `.grid` row to verify the `1.45fr 1fr` split.

## Viewports (this module's own @media — dash-sections.css)
- **1280px** (desktop: KPIs 4-up, grids `1.45fr 1fr`).
- **720px** (between cutovers — still desktop layout per this CSS; confirm).
- **640px** (the module's only breakpoint: `.grid`→1-col, `.kpis`→2-up,
  `.kpi__val`→22px, labels/delta-sub wrap). Shoot at **641** and **640** to catch
  the cutover.
- **390px** (mobile, iPhone-ish: stacked single column).

## Transient / data states to drive
1. **populated** — a seeded account so every block is full: 4 KPI tiles with a
   pink "1 overdue" delta on Outstanding; ActiveJobs with progress bars + a
   "🔥"/"· cold" quote; the money card with its 3-segment bar + legend +
   per-invoice list.
2. **empty** — a brand-new account (no jobs/quotes/invoices/activity):
   - ActiveJobs → "No jobs in flight yet…" + "See pipeline →".
   - QuotesAwaiting → "No quotes out yet…" (count pill suppressed).
   - Outstanding → "$0" + "No invoices yet…" (bar/legend/Nudge-all hidden).
   - Activity → "Nothing yet…" sub, no rows.
   - Kpis → Avg paid job shows "No paid jobs yet"; Outstanding clamped to $0.
3. **money count-up** — film the Outstanding `.money__amt` ticking 0 → owed over
   ~1.4s on first paint (it's the embedded `<Ticker/>`). Re-shoot with
   `prefers-reduced-motion: reduce` and NOTE: the count-up still runs (no guard).
4. **kpi hover** — hover a `.kpi`; capture the `translateY(-2px)` lift + shadow.
5. **inert buttons** — hover/focus a `.qbtn--nudge` / "Nudge all"; document that
   clicking does nothing (no handler) — they look actionable but are no-ops.

## Motion to film
- KPI hover-lift (200ms bounce + shadow).
- `.hero__pill-dot` `ppulse` ring on the ActiveJobs header dot (2s loop).
- Outstanding money count-up (rAF, ~1400ms) — and the no-guard reduced-motion
  case.
- Re-shoot the hover/pulse with `prefers-reduced-motion: reduce` (global clamp to
  0.01ms).

## Notes
- These are SSR blocks — no client interactivity to drive beyond hover. All
  "actions" are `<a href>` navigation; the nudge/view/Nudge-all buttons are
  inert.
- NO fabricated screenshots — capture only what the live `/dashboard` renders.
