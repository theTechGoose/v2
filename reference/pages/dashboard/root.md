# Dashboard Page — Root

> **Status:** Production-target page. **Heavy backend dependency** — needs auth, profile, analytics, notifications, plus extensions to existing CRUD. See `backend.md` §3.

![Dashboard reference](../../paperwork-monsters/project/scratch/dashboard-current.png)

## Purpose

The contractor's authenticated home. Greets by name, surfaces current revenue, shows active jobs / pending quotes / outstanding invoices / recent activity. Includes a side-by-side mobile phone preview that mirrors the same data in a stripped-down 380×760 layout for the iOS app analog.

## Source

- **Prototype HTML:** `v2/reference/paperwork-monsters/project/Paperwork Monsters Dashboard.html` (2848 lines)
- **Inline CSS:** Dashboard.html lines **264–1745** (heavy — defines the entire `.app`, `.sidebar`, `.topbar`, `.hero`, `.kpi`, `.panel`, `.job`, `.quote-item`, `.money`, `.activity-item`, `.phone`, etc. class set)
- **Inline JSX (React 18 + Babel CDN):** Dashboard.html lines **1773–2845**

## Stack notes

The prototype is a **single-file React 18 app** loaded via UMD scripts + Babel-standalone (`Dashboard.html:1747–1749`). Production rebuilds as Fresh 2 routes + Preact islands. **Do not preserve the all-React structure** — the page should be SSR with islands for interactive bits.

The wrapping `<div class="stage">` (window chrome with three traffic-light dots and a faux URL bar) is **prototype-only chrome** that simulates a desktop browser frame in the design tool. **Do not port** — the production app *is* the browser content, not a thumbnail of it.

The `TweaksPanel` (lines 1914–2179) and `useTweaks` are dev tools — **do not port**.

## Route

```
v2/frontend/routes/dashboard/index.tsx        → "/dashboard"  (Fresh, requires auth)
v2/frontend/routes/dashboard/_middleware.ts   → redirects to /login if no x-session-id cookie
```

## Layout (top-down)

```
.app   ────────────────────────────────────────────────────────
├── <Sidebar />                         → components/sidebar.md       (ISLAND: collapse + active state)
└── <main>
    ├── <Topbar />                      → components/topbar.md         (greeting + search + bell + ActivityTicker)
    │   └── <ActivityTicker />          → components/activity-ticker.md (ISLAND: rotating events)
    └── .content
        ├── <Hero />                    → components/hero.md           (greeting copy + $-billed Ticker)
        ├── <KpiCards />                → components/kpi-cards.md      (4 stat tiles)
        ├── .grid
        │   ├── <ActiveJobs />          → components/panels.md         (one of four .panel-based components)
        │   └── <QuotesAwaiting />      → components/panels.md
        └── .grid
            ├── <Activity />            → components/panels.md
            └── <Outstanding />         → components/panels.md

Side preview (desktop only):
    <Phone />                           → components/phone-preview.md  (mobile mockup)
```

Sparkline primitive (SVG mini-chart) is documented in **`components/sparkline.md`** — used by Hero in some variants and reusable for the future analytics dashboard.

The four content panels (`ActiveJobs`, `QuotesAwaiting`, `Activity`, `Outstanding`) share the `.panel` primitive and have similar shapes (header + body + cards) — they're documented together in **`components/panels.md`** with a section per panel. Split into separate files later if the team prefers.

The `<Sparkline />` primitive (`components/sparkline.md`) is **only used inside the prototype's hero copy in some variants** (the live build has no inline spark — see Dashboard.html:2399 `const spark = [22, 28, 26, ...]` is computed but not rendered in this build's `Hero`). Document the primitive anyway because the **mobile pkpis row** in `Phone` reuses the value, and analytics has a `sparkline12mo` field intended for it.

## Page-level state

| State | Where | Default |
|---|---|---|
| `sidebarCollapsed: boolean` | `Sidebar` island, persisted to `localStorage` | `false` |
| `activeNavItem: string` | `Sidebar` island | `'home'` |
| `notifications: Notification[]` | `Topbar` (bell + ticker) — fetched on mount, polled every 10s | `[]` |
| `dashboardStats: DashboardStats` | `Hero` + `KpiCards` — fetched once at SSR | `null` |

Per-tenant scoping is implicit — every fetch uses `x-session-id` from the cookie, the backend resolves to `contractorId`, and only the user's own data comes back. See `backend.md` §3.A and §3.B.

## Backend dependencies

| UI surface | Endpoint | Frequency |
|---|---|---|
| Sidebar profile footer ("Diego R. · Riley Roofing Co.") | `GET /profile` | Once at SSR |
| Sidebar nav badges (`Quotes:4`, `Invoices:3`, `Conversations:2`) | `GET /analytics/dashboard` | Once at SSR (counts are derived) |
| Topbar greeting (`Hey, Diego 👋`) | `GET /profile` (reuse) | Once at SSR |
| Topbar bell unread count | `GET /notifications/unread-count` | On mount + every 30s poll |
| Topbar `⌘K` search | `GET /search?q=&type=` | On user input (debounced 250 ms) — **§6.C, not yet implemented** |
| ActivityTicker events | `GET /notifications?limit=10` | On mount + every 10s poll |
| Hero "$18,420 this month" + KPI tiles | `GET /analytics/dashboard` (single call) | Once at SSR |
| ActiveJobs list | `GET /quotes?status=accepted` (proxy: `Job` is implied — quotes accepted but no signed contract yet) — *or add a real* `GET /jobs` *endpoint when the jobs module ships* | Once at SSR |
| QuotesAwaiting list | `GET /quotes?status=sent` | Once at SSR |
| Outstanding panel | `GET /invoices?status=pending` (then group by aging client-side) | Once at SSR |
| Activity feed | `GET /notifications?limit=4` | Once at SSR |
| Phone preview | (decorative — uses the same data) | Reuses fetched data |

**Bottleneck:** without `/analytics/dashboard`, the page would need 4–5 separate fetches just to populate the Hero + KPIs. Land that endpoint first (`backend.md` §3.D).

## Auth

**Required.** The Fresh middleware at `routes/dashboard/_middleware.ts` reads `x-session-id` from the cookie. Missing or invalid → `Response.redirect('/login', 302)`. All API proxies forward the header.

## Mobile breakpoints

The prototype uses **two layouts**:
- **Desktop (≥1024px):** sidebar visible, two-column `.grid` for panels
- **Mobile (<1024px):** sidebar collapses to icons-only or hides behind a hamburger overlay, panels stack single-column

The `Phone` preview is **desktop-only** (decorative). On mobile, the actual layout *replaces* the Phone preview with the production responsive layout — they're never both rendered.

The dashboard is **EN-only** in the prototype (no `data-i18n` attributes). When ES is added later, follow the landing page's `langSignal` pattern — see `pages/landing/components/i18n.md`.

## Implementation order

1. Tailwind theme + global CSS (already in place from Landing).
2. **Auth flow** — login screen, OTP, session cookie. Without this, the route can't render.
3. `/dashboard` route shell with `<Sidebar />` + `<Topbar />` + empty `.content`.
4. `<KpiCards />` — needs `/analytics/dashboard`. Static placeholder until then.
5. `<Hero />` — copy + Ticker animation.
6. `<ActiveJobs />`, `<QuotesAwaiting />`, `<Outstanding />`, `<Activity />` — each fetches independently.
7. `<ActivityTicker />` — wire into topbar.
8. `<Phone />` — last; decorative, no API.

## What NOT to port

- The `<div class="stage">` browser-frame chrome (`Dashboard.html:2774–2786`).
- The `<div class="annot">` "Desktop · 1240 × 1040" / "Mobile · 380 × 760" annotations (prototype-only).
- The `TweaksPanel` and `useTweaks` (dev tool only).
- `window.LOGO_DATA_URL` — the 1.6 MB inline base64. Use the `static/logo-monster.png` file like the landing page.
- The `<Phone />` mobile preview's role as a *side-by-side preview*. In production the responsive layout shows on actual mobile devices; the desktop view does not include a phone mockup.

## Conventions

Same as `pages/landing/`. Code blocks are verbatim from the prototype; the Preact translation is in a separate sub-section per component file. The prototype is React; the production translation is Preact (`useState` → `useState` from `preact/hooks`, `className` → `class`).

## Shared primitives needed

| Primitive | Where defined | Reused by |
|---|---|---|
| `.panel` (white card w/ header + content) | Dashboard.html inline CSS | `<ActiveJobs>`, `<QuotesAwaiting>`, `<Activity>` |
| `.kpi` (stat tile w/ icon + value + delta) | Dashboard.html inline CSS | `<KpiCards>` |
| `<I d={...} size={...} sw={...}/>` icon component (`Dashboard.html:2187–2228`) | Inline | every visual element with an icon |
| `Ticker` (animated number) | `Dashboard.html:2339–2343` | Hero, Outstanding, Phone hero |
| `<Spark>` SVG sparkline | `Dashboard.html:2294–2337` | Hero (some variants), Phone pkpis (potential) |
| `.qbtn--nudge` / `.qbtn--view` (tiny action buttons) | Dashboard.html inline CSS | Quotes-awaiting cards, Outstanding "Nudge all" |

Build the icon set as `v2/frontend/components/ui/icons.tsx` exporting one component per ICN key (the prototype's ICN map at `Dashboard.html:2193–2228` lists all 30+ icons used across Dashboard + Assistant). Reuse on Assistant page.
