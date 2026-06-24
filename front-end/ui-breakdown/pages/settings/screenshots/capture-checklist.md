# Capture checklist — page `/settings`

**Theme:** light only. **Auth:** any contractor; dev master OTP `000000` at
`http://localhost:5280`. **No fabricated screenshots.**

## Route / URL
- `http://localhost:5280/settings`.

## Full-page composition shots (app-shell + island)
Capture the whole shell so the page's place in the app reads:
- **1280px** — DashSidebar (active="settings") + DashTopbar (greeting + date) +
  the SettingsPage content scrolling in `.content`.
- **640px** — sidebar collapsed to overlay; topbar sticky; `.hero`/`.grid`
  stacked to one column.
- **390px** — phone; full top-to-bottom scroll (hero → summary → editors →
  payments → danger zone).

## Page-level notes
- The detailed component states (loading skeleton, save flashes, danger-armed,
  payment-mismatch) are in `components/settings-page/screenshots/capture-checklist.md`.
- If a super-admin is impersonating, the global ImpersonationBanner pins above
  the topbar — optional shot to show the shell with the banner present.

## Motion
- Load skeleton shimmer only (shared). Reduced-motion clamps it globally.
