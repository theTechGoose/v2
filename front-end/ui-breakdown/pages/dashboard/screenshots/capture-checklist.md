# Capture checklist — /dashboard (whole page)

**Theme:** light only (no dark mode exists).
**No backend this session → NO fabricated screenshots.** This file lists what
to shoot once the app is running.

## Route / auth
- `http://localhost:5280/dashboard`.
- Log in via the dev master OTP `000000` (any seeded phone). New-user vs
  returning-user matters for two states (see below).
- Serve: `deno task serve` (frontend :5280, backend :4280).

## Viewports (this page's real @media widths — from dashboard.css)
- **1280px** — desktop; `.kpis` 4-up, both `.grid` rows two-column,
  `.assistant-cta` side-by-side.
- **721px** — just above the assistant-cta restack + shell cutover.
- **720px** — `.assistant-cta` restacks to a column (title 40→30px, buttons
  full-width, art 130px).
- **640px / 641px** — SHELL CUT: at ≤640 the `.app` flex shell becomes
  body-scroll (`display:block`, `.content` overflow visible), sidebar → fixed
  drawer, `.grid` → 1-col, `.kpis` → 2-up. At ≥641 the desktop rail + inner
  scroll return. Shoot both sides of this seam.
- **390px** — iPhone-ish mobile (drawer closed; 2-up KPIs; stacked grids).

## Crop targets
- Full page (the `.content` column) at each viewport.
- `.assistant-cta` banner alone (desktop + 720 restacked).
- The `.kpis` rail (4-up vs 2-up).
- One `.grid` row (ActiveJobs+QuotesAwaiting) and the other (Activity+Money).
- `SetupChecklist` pink card (when items remain).

## Transient states to drive
1. **loading** — hard-navigate to `/dashboard` on a cold tab (clear
   `sessionStorage` key `pm:dash-cache:v1`) → `DashboardSkeleton` (shimmer).
2. **warm** — navigate away and back → KPIs/hero paint instantly from cache, no
   skeleton (proves the dash-cache warm-start).
3. **populated** — a seeded account with jobs/quotes/invoices/notifications →
   all sections filled.
4. **honest-empty** — a brand-new account: ActiveJobs empty CTA, QuotesAwaiting
   empty line, Outstanding "all paid / no invoices", Activity empty sub.
5. **coachmark overlay** — first visit after onboarding (clear
   `localStorage["pm:assistant-coachmark-shown"]`) → dark spotlight overlay
   cutting a hole over the sidebar "My Assistant" button + pink speech bubble.
   Film the ~720ms staged entrance (see assistant-coachmark capture-checklist).
6. **welcome toast** — append `?welcome=back` → top-right pill fades in for 3s,
   then the query param is stripped. (Returning-user path from /verify.)
7. **error** — block the fetches (offline) so all six reject → `.dashpage-error`
   line ("Couldn't load…"). Note: `.dashpage-error` is UNSTYLED (no CSS rule).

## Motion to film (all from real CSS / JS — see per-component checklists)
- `.assistant-cta` hover lift (220ms bounce) + inner btn nudge.
- KPI tile hover lift (200ms bounce).
- Ticker count-up on the Money-owed figure (rAF, ~1400ms cubic ease-out).
- SetupChecklist progress-bar width fill (480ms).
- Coachmark full entrance + idle loops; WelcomeBackToast slide-in (280ms).
- Re-shoot each under `prefers-reduced-motion: reduce`.
