# Page — /dashboard

The authenticated **home** route. An app-shell page: SSR renders only the
shell + greeting; one big client island (`DashboardPage`) fans out all the
data fetches and assembles the page body. Two more self-gating overlay islands
(`AssistantCoachmark`, `WelcomeBackToast`) sit outside the shell.

Source route: `routes/dashboard/index.tsx` (copied verbatim to `js/index.tsx`).

## Purpose
First screen after login. Surfaces, top-to-bottom: a dominant **assistant
banner** CTA, a post-onboarding **setup checklist**, four **KPI** tiles, then two
two-column rows — Active jobs + Quotes awaiting, and Activity + Money owed.

## SSR / app-shell composition (mount order)
The route is `define.page(...)` — server-rendered shell. It computes the
greeting on the server and mounts islands in this DOM order:

```
<>
  <Head> title + <link rel=stylesheet href="/dashboard.css">
  <div class="app">                          ← app-shell flex container
    <DashSidebar active="home" />            ← SHARED island (see shared-components/dash-sidebar) — reference only
    <main class="main">
      <DashTopbar greetingDate greetingName/>← SHARED island (see shared-components/dash-topbar) — reference only
      <div class="content">                  ← the scroll column (CSS in dashboard-page.css)
        <DashboardPage />                     ← THIS PAGE's main island (page-local: components/dashboard-page)
      </div>
    </main>
  </div>
  <AssistantCoachmark />                      ← page-local island; one-shot overlay, self-gates on localStorage
  <WelcomeBackToast />                        ← page-local island; self-gates on ?welcome=back
</>
```

Mount order matters: `DashSidebar` must hydrate **before** `AssistantCoachmark`
runs, because the coachmark polls the DOM for the sidebar's `.sb__textus`
("My Assistant") button to position its spotlight hole (retries up to 30× @
120ms). The two overlays render outside `.app` so they layer above the whole
shell at `z-index:9999`.

## `<Head>`
- **Title:** `tFor(lang, "dashboardPage.docTitle", { brand })` → `Dashboard ·
  Paperwork Monster` (es: localized).
- **CSS:** `<link rel="stylesheet" href="/dashboard.css">` — the single feature
  stylesheet (`static/dashboard.css`, ~2600 lines). It also defines the
  sidebar/topbar/phone-preview classes (shared specs own those). Tokens come
  from `static/_proto/colors_and_type.css` (loaded app-wide, not here).

## SSR data (server-computed, passed as props)
Only the greeting is computed SSR — from `ctx.state.user` (the resolved
session `User`):
- `lang` = `user.language === "es" ? "es" : "en"`.
- `greetingName` = first token of `user.name` (trimmed) or `tFor(lang,
  "common.thereFallback")` (`"there"`).
- `greetingDate` = `"{Weekday} · {Month} {date}"` from `new Date()` via the
  `WEEKDAY_KEYS` / `MONTH_KEYS` i18n arrays.

These two strings are passed to **DashTopbar** (shared). `DashboardPage` itself
receives NO SSR data props — it is a frozen-shell-then-client-fetch island
(see the anti-pattern below).

## Section layout (what DashboardPage renders, in order)
1. `.assistant-cta` banner (green→teal gradient hero with monster art + "My
   Assistant" + "Call support" buttons). **CSS owned by this page** →
   `css/dashboard-page.css`.
2. `<SetupChecklist/>` (page-local island) — pink onboarding checklist; renders
   nothing once complete or dismissed.
3. `<Kpis/>` — 4 tiles (Active jobs / Outstanding / Quotes pending / Avg paid job).
4. `<div class="grid">` → `<ActiveJobs/>` + `<QuotesAwaiting/>`.
5. `<div class="grid">` → `<Activity/>` + `<Outstanding/>`.

Items 3–5 are exports of **DashSections** (page-composition; `components/
dash-sections`). `Outstanding`'s money figure and the dead `Hero` use the
**Ticker** island (`components/ticker`).

## Cross-page note — QuoteCard
The breakdown task description claimed DashboardPage renders the **QuoteCard**
island. **It does not** (confirmed against source): DashboardPage imports only
`ActiveJobs, Activity, Kpis, Outstanding, QuotesAwaiting` from DashSections,
`SetupChecklist`, `Ticker` (transitively), and the shared Skeletons. There is
no `QuoteCard` import on `/dashboard`. The "Quotes awaiting" strip is the
`QuotesAwaiting` panel (its own simple `.quote-item` rows), **not** the
`/quotes` `QuoteCard`. So: no `quote-card` folder is written here, and the only
honest cross-page note is that the dashboard's quote strip is a *separate, much
simpler* presentation than the canonical `QuoteCard` (specced under
`pages/quotes/components/quote-card/`).

## Build order (rebuild this page mechanically)
1. Tokens + `dashboard.css` shell classes (`.app`,`.main`,`.content`) present.
2. Shared **DashSidebar** + **DashTopbar** (reference specs) mounted in the shell.
3. **Ticker** island (leaf; needed by DashSections).
4. **DashSections** exports (`Kpis`,`ActiveJobs`,`QuotesAwaiting`,`Outstanding`,
   `Activity`) — pure presentational, fed row arrays.
5. **SetupChecklist** island (fetches `/profile`).
6. **DashboardPage** island — wire the parallel fetches + the `dash-cache`
   warm-start, map DTOs→rows, render assistant-cta + checklist + sections.
   Use the shared **Skeletons** for the loading state.
7. **AssistantCoachmark** + **WelcomeBackToast** overlays last (depend on the
   hydrated sidebar / URL respectively).
8. Route shell `index.tsx` composes everything + computes the greeting SSR.

## Page-local components (full specs under `components/`)
| folder | source | bucket |
|---|---|---|
| `dashboard-page` | `islands/DashboardPage.tsx` | island (data fan-out) |
| `dash-sections` | `components/DashSections.tsx` | page-composition (static SSR sections) |
| `ticker` | `islands/Ticker.tsx` | island (rAF count-up) |
| `setup-checklist` | `islands/SetupChecklist.tsx` | island (onboarding checklist) |
| `assistant-coachmark` | `islands/AssistantCoachmark.tsx` | island (one-shot overlay) |
| `welcome-back-toast` | `islands/WelcomeBackToast.tsx` | island (URL-gated toast) |

Shared (reference only, NOT re-specced here): DashSidebar, DashTopbar,
Skeletons (`ShimmerStyle`/`SkelBlock`), MobileViewport, ImpersonationBanner.

## ANTI-PATTERN (the classic whole-page island) — FLAGGED
`DashboardPage` is the textbook "whole-page island": the SSR route renders an
empty shell, the island hydrates, then fetches **6 endpoints in parallel** on
mount (`/analytics/dashboard`, `/jobs`, `/quotes?status=sent`,
`/invoices?status=pending`, `/customers`, `/notifications`) and only THEN
renders the body. Until those resolve the user sees `DashboardSkeleton`.
- **Mitigation already present:** `lib/dash-cache.ts` warm-starts the hero+KPIs
  from a `sessionStorage` snapshot (`readCached()`), so navigating *back* to
  `/dashboard` skips the full skeleton flash; the mount fetch becomes a silent
  background refresh.
- **No `location.reload()`** anywhere in this scope — good. (Checked all six
  scope islands; the only full navigations are `<a href>`s and DashSidebar's
  logout, which is in the shared spec.)
- **The form+PRG / Fresh Partial fix:** the hero greeting + KPI tiles + jobs
  row are all read-only projections of `DashboardStats`/`Job[]` — they have NO
  interactivity that requires an island. They could be **server-rendered** in
  the route handler (resolve the stats SSR, render the tiles as static HTML)
  and only the genuinely-interactive bits (the Ticker count-up, the
  nudge/quote buttons) kept as small islands or progressively-enhanced. That
  removes the cold-load skeleton entirely and the whole-account rollup is
  fetched once on the server instead of after hydration. The "Nudge by text" /
  "Nudge all" buttons (currently inert — see DashSections spec) would become
  `<form method=POST>` → server action → PRG redirect with a flash.

## DATA-SHAPE HAZARD — dashboard stat tiles (FLAGGED)
The four KPI tiles + Money-owed bar are derived from `DashboardStats`, a
**whole-account rollup** (`/analytics/dashboard`) that aggregates counts across
all quotes/contracts/invoices/customers + `quotedValueCents` (Σ sent quotes) +
`revenue.sparkline12mo` + `invoices.agingBuckets`. Because `DashSidebar` mounts
this same rollup on *every* authed page, the existing mitigation is
`lib/dash-cache.ts` (single-flight + sessionStorage warm start + a pub/sub so
siblings share one fetch). See `data-model.md` §5.1. Rebuild target:
precompute these counters incrementally on the backend; never recompute by
scanning per request.
