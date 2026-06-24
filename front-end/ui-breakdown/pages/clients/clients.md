# Page: /clients

## Purpose
The contractor's client roster, framed editorially rather than as a CRM table.
An on-mount fetch pulls a rollup-enriched `CustomerCard[]` plus two analytics
aggregates (leaderboard + segment mix); the page renders an editorial hero with
live counts, a dark "Today's loop" check-in ribbon, a searchable/filterable grid
of mood-colored client cards with tap-to-open contact panels, and a sticky right
rail (top clients + who's-on-your-books). A contractor can add a client via an
inline modal (`POST /customers`).

## App-shell composition (order)
Route `routes/clients/index.tsx` (`define.page`) renders:
```
<Head>…</Head>
<div class="app">
  <DashSidebar active="clients" />        ← SHARED (shared-components/dash-sidebar)
  <main class="main">
    <DashTopbar greetingDate greetingName /> ← SHARED (shared-components/dash-topbar)
    <div class="content">
      <ClientsPage />                      ← island (components/clients-page)
    </div>
  </main>
</div>
```
`ClientsPage` then composes (build order): `ClientsHero` → `LoopBar` →
`ClientsBoard` (with `TopClients` + `ClientsSegments` as rail children) → inline
Add-Client modal. The shared shell, `Skeletons`, `MobileViewport`,
`ImpersonationBanner` are NOT re-spec'd here (see `shared-components/`).

## `<Head>`
- **Title:** `tFor(lang, "clientsRoute.docTitle")` → **"Clients · Paperwork
  Monster"** (`es` variant from the dict).
- **CSS (two stylesheets, order matters):**
  - `<link rel="stylesheet" href="/dashboard.css" key="css-dashboard" />` — the
    token + shell base (`--brand-*`, `--fg-*`, `.app`, `.main`, `.content`).
  - `<link rel="stylesheet" href="/clients.css" key="css-clients" />` — this
    page's component styles (copied to `css/clients.css`; per-component extracts
    under `components/*/css/`).

## SSR data
- The route SSRs **no page-body data**. It only computes shell props from
  `ctx.state.user`:
  - `lang` = `user.language === "es" ? "es" : "en"`.
  - `greetingName` = first word of `user.name` (or localized `there` fallback).
  - `greetingDate` = `"{weekday} · {month} {date}"` localized via `WEEKDAY_KEYS`
    / `MONTH_KEYS` against `new Date()`.
- All page content is fetched **client-side** by the `ClientsPage` island on
  mount: `Promise.all([ GET /clients, GET /analytics/clients/top?limit=5,
  GET /analytics/clients/segments ])`. See data-model.md §4 (ClientsPage →
  `CustomerCard[]`, `TopClient[]`, `ClientSegmentRow[]`) and hazards #3/#6.

## Sections
1. **ClientsHero** (`.ph2`) — editorial header: pulsing crumb ("Clients · N on
   the books"), big headline (`The N people who keep the lights on.` / empty
   variant), a stat sub (jobs in flight · $ owed · quiet clients), and the pink
   **Add a client** CTA. → `components/clients-sections` (`ClientsHero`).
2. **LoopBar** (`.loopbar`) — dark teal ribbon of up to 3 drafted check-ins with
   stacked avatars + "Open the loop" CTA; honest-empty when no picks. →
   `components/clients-sections` (`LoopBar`).
3. **ClientsBoard** (`.ctoolbar2` + `.clay2`) — the interactive core: search +
   six filter chips (with per-status counts) + a static "Warmth" sort, above the
   `.ccards2` mood-card grid; each card opens an in-place contact panel.
   → `components/clients-board` (island).
4. **Right rail** (`.cside2`, slotted into the board) — **TopClients** (`.ctop2`
   leaderboard) + **ClientsSegments** (`.csegment2` segment-mix bars). →
   `components/clients-sections` (`TopClients`, `ClientsSegments`).
5. **Add-Client modal** — inline-styled overlay form (`POST /customers`), owned
   by the `ClientsPage` island.

## Local components
| folder | source | bucket / tier | note |
|---|---|---|---|
| `components/clients-page` | `islands/ClientsPage.tsx` (242) | island | whole-page data island; on-mount fetch + inline add modal |
| `components/clients-sections` | `components/ClientsSections.tsx` (268) | page-composition (static; Hero has an island-owned `onAdd` callback) | 4 exports: Hero, LoopBar, TopClients, ClientsSegments |
| `components/clients-board` | `islands/ClientsBoard.tsx` (371) | island | toolbar + card grid + slide-up panel; URL-synced `?segment=` filter |

**Shared (reference only — not re-spec'd):** `DashSidebar`, `DashTopbar`,
`Skeletons` (`ShimmerStyle`/`PageHeaderSkeleton`/`CardGridSkeleton`).
**Shared helpers copied into component `js/`:** `lib/clients-display.ts`
(mood/status/since/balance/story/cta/segment/address derivation +
`dollars`/`initialsOf`/`numberWord`) and `lib/dash-icons.tsx` (`I` + `ICN`).

## Dead code on this surface
- **`islands/ContactForm.tsx` (85)** — **DEAD.** Zero imports anywhere in the
  repo (verified via grep over `islands/`, `routes/`, `components/`, and a
  repo-wide `*.tsx` sweep). It is a landing/auth OTP capture form
  (`landingClient.sendOtp` → redirect to `/verify`), NOT a clients component, and
  is **not** mounted by `ClientsBoard` (the add-client form on `/clients` is the
  inline modal inside `ClientsPage`). Per spec policy, no folder is written for
  it. Belongs to the auth/landing surface if anything (data-model.md lists it
  under `LoginForm/LandingScripts/ContactForm → /auth/send-otp`).
- **`@keyframes ccard2-editorial-in`** (clients.css) — declared but never
  applied; the cards' staggered entrance never plays (see clients-board.md §6).
- **`.cpage-error`, `.ctop2__empty`, `.csegment2__empty`, `.ccards2__empty`** —
  classes emitted in JSX with **no CSS rule** in `static/*.css` (unstyled flow).

## Build order
1. Add `/clients.css` (+ ensure `/dashboard.css` tokens) and the route shell
   (`DashSidebar active="clients"` + `DashTopbar` + `<ClientsPage/>` in
   `.content`), `<Head>` title + both stylesheets.
2. Port `lib/clients-display.ts` + `lib/dash-icons.tsx` (shared deps).
3. Build `ClientsSections` (static presentational; verify all honest-empty
   branches) — Hero, LoopBar, TopClients, ClientsSegments.
4. Build `ClientsBoard` island (toolbar + card grid + panel; URL `?segment=`
   sync via pushState/popstate; outside-click/Escape close).
5. Build `ClientsPage` island (on-mount `Promise.all` fetch + skeleton/error
   gates; compose 3+4; inline Add-Client modal `POST /customers` + refresh).
6. Fix-list to carry forward: apply the dead `ccard2-editorial-in` animation;
   style `.cpage-error`; refresh `top`+`segments` after add (stale-rail bug);
   promote the modal to a real dialog; lift inline modal styles to tokens.
