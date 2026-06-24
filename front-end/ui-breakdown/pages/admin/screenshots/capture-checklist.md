# Capture checklist — page `/admin`

**Theme:** light only. **Auth:** **SUPER-ADMIN REQUIRED** (dev master OTP
`000000` to log in, but the account must hold the `superAdmin` flag, else
`_middleware.ts` redirects to `/dashboard`). **No fabricated screenshots.**

## Route / URL
- `http://localhost:5280/admin`.

## Full-page composition shots (app-shell + island)
- **1280px** — DashSidebar (active="admin") + DashTopbar (greeting + date) +
  AdminPage (search card + results table) in `.content`.
- **980px** — content max-width.
- **640px / 390px** — sidebar overlay; table in horizontal scroller; quick-select
  row wrapped.

## Page-level notes
- Detailed island states (loading / empty / list / busy / error / impersonate)
  are in `components/admin-page/screenshots/capture-checklist.md`.
- **Impersonation round-trip** (key shot pair): from `/admin` click Impersonate
  → land on `/dashboard` AS the target user with the global ImpersonationBanner
  pinned at top (the maroon bar) → click "Return to your account" to come back.
  This demonstrates the entry (AdminPage) ↔ exit (shared ImpersonationBanner)
  counterpart pair.

## Motion
- None on AdminPage. The only motion in the round-trip is the page navigation
  itself.
