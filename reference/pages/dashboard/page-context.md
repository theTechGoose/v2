# Dashboard

## Purpose
The contractor's home page after login. Surfaces (1) wins/momentum copy, (2) high-level money + workload KPIs, (3) active jobs and quotes-awaiting work queues, (4) automation activity, and (5) money-owed roll-up. To the right, a sticky phone mockup shows what the same surface looks like in the mobile companion app.

## Top-level structure
The page is a `.stage` grid with two columns: desktop mockup (left) + optional `.phone` preview (right). The mockup is a fake-browser `.window` shell containing `.app` → `<aside class="sb">` + `<main class="main">` (`.topbar` + `.content`).

Inside `.content`, top-to-bottom:

1. **Hero greeting** — `<Hero>` — see `shared/hero-banner` and `components/greeting-hero/`.
2. **KPI grid** — `<Kpis>` — 4 metric cards. See `shared/kpi-card` and `components/kpi-grid/`.
3. **Two-column row** — `.grid` { 1.45fr | 1fr }:
   - `<ActiveJobs>` — see `components/active-jobs-panel/`.
   - `<QuotesAwaiting>` — uses `.quote-item` rows; see `pages/quotes/components/quote-item-card/` for the related component.
4. **Two-column row** — `.grid` { 1.45fr | 1fr }:
   - `<Activity>` — see `components/daily-summary/`.
   - `<Outstanding>` — see `components/money-stacked-bar/`.

Below the mockup: `.annot` "Desktop · 1240 × 1040". The phone column has its own `.annot` "Mobile · 380 × 760".

## Layout chrome (uses `shared/`)
- `shared/sidebar` — `.sb__*` left rail with the top-level nav.
- `shared/topbar` — `.topbar__*` 60px header (menu, greeting, search, bell).
- `shared/hero-banner` — `.hero__*` greeting card.
- `shared/kpi-card` — `.kpi__*` × 4.
- `shared/panel` — `.panel__*` shell for active jobs / quotes / activity.
- `shared/job-card` — `.job__*` rows in active jobs.
- `shared/activity-item` — `.activity-item__*` rows.
- `shared/phone-preview` — `.phone__*` device on the right.
- `shared/annotation-dots` — `.annot__*` mockup labels.

## Page-unique components
- [greeting-hero](components/greeting-hero/) — the dashboard's specific hero copy + ticker number.
- [kpi-grid](components/kpi-grid/) — the dashboard's 4 metric definitions (Active jobs, Money owed, Quotes pending, Avg. job size).
- [active-jobs-panel](components/active-jobs-panel/) — the active-jobs list with its specific 5-row dataset + status chips.
- [money-stacked-bar](components/money-stacked-bar/) — `.money__*` aging-bucket bar (Current / 1–14d / Overdue) with legend.
- [daily-summary](components/daily-summary/) — "What we handled today" automation feed.
- [phone-notification-preview](components/phone-notification-preview/) — the phone's hero-card variant ("2 quotes just got accepted").

## Notable interactions
- The `useTweaks` hook drives a `<TweaksPanel>` with two toggles: `sidebarCollapsed` and `showPhone`. The panel itself (`tweaks-panel.jsx`) is a designer overlay, not a user-facing feature.
- `<Ticker value={…}>` animates count-ups on mount.
- The activity ticker in the topbar rotates events every 3.8s.

## Source
`extracted/Paperwork Monsters Dashboard.html` (also copied at `pages/dashboard/raw.html`).
