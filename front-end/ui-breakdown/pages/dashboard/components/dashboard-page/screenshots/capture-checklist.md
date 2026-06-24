# Capture checklist — DashboardPage

- **Route:** `/dashboard` (auth-gated — log in via dev master OTP `000000`).
- **Viewports** (dashboard.css; shell cuts at **640/641px**): 390 (mobile,
  KPIs 2-up, sidebar→drawer), 980 (tablet), 1280 (desktop, `--container-product`).
- **Crop targets:** the `.content` region (the island); plus each section block
  (KPIs row, Active jobs, Quotes awaiting, Outstanding, Activity).
- **States to drive:**
  - `loading` — skeletons on first mount (throttle network / use the loading case).
  - `ready` — populated from `lib/dash-seed.ts` (`SEED_*`).
  - `empty` — brand-new account (every block's honest-empty branch + SetupChecklist visible).
  - `error` — fetch failure (`.dashpage-error` — note: **unstyled**, renders as plain text).
- **Theme:** light only. **No fabricated screenshots** — capture against a seeded dev backend.
