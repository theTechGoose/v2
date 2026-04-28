# Clients Page — Root

> **Status:** Production-target page. **Light backend dependency** — needs `GET /clients` with derived per-client metrics (last contact, balance, active jobs). Most copy ("stories") is editorial mock data in the prototype; production will derive narrative chips from the same data the assistant generates. See `backend.md` §3 (existing `Customer` CRUD) plus a small extension for the per-client roll-up endpoint.

## Purpose

The contractor's "people on the books" view. A 12-card editorial grid where each client is rendered as a moodboard-style card: a colored gradient band drives a "warmth" signal (active job → green, owes you → pink, quiet → coffee, VIP/regular → teal). Each card carries a one-sentence narrative ("the story") written in the assistant's voice and a single suggested next action ("Send the warm offer", "Offer the split-pay", etc.). Tapping a card slides a contact detail panel up over the card (phone / email / address + Message / Open card actions).

The right rail surfaces two supporting modules: a teal **TopClients** leaderboard (top 5 by 12-month revenue) and a **ClientsSegments** mini bar chart (Property mgmt / Homeowners / Small biz / HOAs).

Above the grid sit a **ClientsHero** (large editorial headline + "Add a client" CTA) and a dark **LoopBar** ribbon ("Today's loop — 3 friendly check-ins, drafted for you") that opens a flow into the assistant page.

## Source

- **Prototype HTML:** `v2/reference/paperwork-monsters/project/Paperwork Monsters Clients.html` (4568 lines)
- **Inline CSS:** Clients.html lines **264–3023** (heavy — defines `.ph2`, `.loopbar`, `.ctoolbar2`, `.ccards2`, `.ccard2*`, `.clay2`, `.cside2`, `.ctop2`, `.csegment2`, `.cseg2-row`, `.cloop`, plus the shared dashboard chrome `.app/.sidebar/.topbar/.stage`)
  - Clients-specific CSS sits at lines **1748–2299** and **2935–3000**
  - The block at **2301–2934** is **older "v1" card styles** (`.ph`, `.ccard` without the `2`) kept for safety — **do not port**, the live build uses the `*2` selectors
- **Inline JSX (React 18 + Babel):** Clients.html lines **3024–4566**
  - Shared chrome (Sidebar, Topbar, ActivityTicker, ICN, NAV, `<I>`) is identical to Dashboard / Assistant — **lines 3464–3899 are copies of the dashboard ones, do not re-document**
  - Clients-specific code starts at **line 3902** (`// =============== CLIENTS PAGE ===============`)

## Stack notes

The prototype is the same single-file React 18 + Babel setup used elsewhere. Production is Fresh 2 routes + Preact islands. The wrapping `<div class="stage">` (browser-frame chrome) is prototype-only — do not port. `TweaksPanel`, `useTweaks`, `TWEAK_DEFAULTS` are dev tools — do not port.

The Sidebar, Topbar, Spark, Ticker, ActivityTicker, NAV, ICN, and `<I>` components in Clients.html are **identical copies** of the Dashboard ones (Clients.html:3464–3899 ≈ Dashboard.html:2187–2540). **Reuse the dashboard component files; do not re-document.**

## Route

```
v2/frontend/routes/clients/index.tsx          → "/clients"
v2/frontend/routes/clients/[clientId].tsx     → "/clients/:clientId"   (when card → full page lands)
v2/frontend/routes/clients/_middleware.ts     → requires auth (same as dashboard)
```

The active card's expand/collapse state is **page-level (signal)** for v1; only one card can be open at a time, and Esc closes it. This is identical to the prototype (`ClientsCards` keeps an `openId`). Once a real client detail view exists, the panel becomes a redirect to `/clients/:clientId` instead of an inline overlay.

## Layout (top-down)

```
.app
├── <Sidebar />                       ← reuse from dashboard (`pages/dashboard/components/sidebar.md`)
└── <main>
    ├── <Topbar />                    ← reuse from dashboard (`pages/dashboard/components/topbar.md`)
    └── .content
        └── <ClientsPage>             (no extra wrapper; just `<>…</>`)
            ├── <ClientsHero />        → components/clients-hero.md       ✅ build
            ├── <LoopBar />            → components/loop-bar.md           ✅ build (static; CTA links to /assistant)
            ├── <ClientsToolbar />     → components/clients-toolbar.md    ✅ build (search + filter chips + sort)
            └── .clay2                 (grid: 1fr | 280px, stacks <1100px)
                ├── <ClientsCards />   → components/client-card.md        ✅ build (grid of <ClientCard>)
                └── .cside2 (sticky)
                    ├── <TopClients />     → components/top-clients.md      ✅ build
                    └── <ClientsSegments/> → components/clients-segments.md ✅ build

(Defined in the prototype but NOT mounted in the rendered page:)
        <TodayLoop />                  → components/today-loop.md          ⚠️ defined-but-unused
                                         The prototype keeps a richer "Today's loop" panel as well as the
                                         slim LoopBar ribbon. It is not currently rendered by ClientsPage.
                                         Build only if a future iteration mounts it on the side rail.

Side preview (desktop only):
└── <PhoneClients />                  → components/phone-preview-clients.md   ✅ build (decorative)
                                        Same "decorative on desktop" rule as Dashboard's <Phone>.
                                        Note: the Phone for the Clients page actually renders a mobile
                                        DASHBOARD layout (greeting + KPIs + money-owed + quotes-waiting),
                                        not a mobile clients view — it's the iOS app analog the user
                                        opens after tapping into a client.
```

## Page-level state

| State | Where | Note |
|---|---|---|
| `filter` | `ClientsPage` island, default `'all'` | One of `'all'\|'active'\|'lead'\|'owes'\|'regular'\|'cold'` — drives the `CLIENTS.filter(...)` |
| `query` | `ClientsPage` island | Free-text; matched against `name`, `contact`, `last`, `phone` (case-insensitive) |
| `openId` | `ClientsCards` island | `name` of the card currently expanded; `null` = none. Esc + outside-click close it. |
| `sidebarCollapsed` | Reuse from Sidebar island | Same as Dashboard |

`filter` and `query` could each live in URL search params (`?filter=owes&q=hilltop`) — preferred for shareability and back/forward, but the prototype keeps them in React state. Adopt URL params in production.

## Backend dependencies

**v1 (mostly works against existing v2 endpoints):**

| UI surface | Endpoint | Notes |
|---|---|---|
| Sidebar profile + counts | `GET /profile`, `GET /analytics/dashboard` | Same as Dashboard |
| Topbar bell + ticker | `GET /notifications` | Same as Dashboard |
| Cards list | `GET /clients` (existing v2 `Customer` list) | Each card needs derived fields (see below) |
| ClientCard expanded panel | `GET /clients/:id` | `phone`, `email`, `address` already on the v2 `Customer` DTO |
| TopClients | `GET /analytics/clients/top?period=12mo&limit=5` | **NEW** — small extension; sums quote/invoice totals per customer |
| ClientsSegments | `GET /analytics/clients/segments` | **NEW** — group counts by `segment` field (or derived from job types) |
| LoopBar drafts (Today's loop) | `GET /agents/conversations?suggested=today` (FUTURE) | Static seed for v1; full draft generation lives in the agents module |

**Per-card derived fields needed on the list response (`GET /clients`):**

| Field | Derivation |
|---|---|
| `last`, `lastWhen`, `lastTone` | Most-recent job/quote/invoice activity, formatted relatively + tone (`hot`/`warm`/`cold`) |
| `balance` | Sum of `pending` invoices minus deposits-on-file. Positive = owes; negative = credit |
| `balanceSub` | One-line caption for balance ("INV-208 · due in 3 days", "50% deposit on file", "settled · quote out $5,800") |
| `jobs`, `jobsSub` | Count of active jobs and a one-word state ("active", "scheduled", "overdue", "no active jobs") |
| `status` | `'active'\|'lead'\|'owes'\|'regular'\|'cold'` — derived priority used for the `moodFor()` mood band |
| `temp` | 0–100 "warmth" score for sorting (the toolbar's "Warmth" sort) |
| `vip` | Boolean — top-quartile by 12-month revenue, or manually flagged |
| `daysSinceContact` | Days since last assistant message OR last status update on a job/quote |

The "stories" copy (`STORIES` map in the prototype) is **AI-generated narrative** in production — pull from the agents module's per-conversation summary. Until that exists, ship a deterministic fallback: `"<n> days quiet — say hi"` / `"Open quote · viewed <m>×"` / `"INV-### · <k> days late"` derived from the same fields as `lastWhen`/`balance`.

## Auth

**Required.** Same `_middleware.ts` as dashboard.

## Mobile breakpoints

The prototype defines a single hard breakpoint at **1100 px** (Clients.html:2294):

```css
@media (max-width: 1100px) {
  .clay2  { grid-template-columns: 1fr; }   /* sidebar drops below cards */
  .cside2 { position: static; }             /* unstick */
  .loopbar { grid-template-columns: 1fr; gap: 12px; } /* avs row stacks */
  .ph2    { flex-direction: column; align-items: flex-start; }
}
```

**Below 768 px** (production needs to extend the prototype):
- `.ccards2` collapses from `repeat(auto-fill, minmax(300px, 1fr))` to a single column
- `.ctoolbar2` filters wrap to a second row
- `.ph2__title` drops from 44 px to ~28 px and `.ph2__cta` becomes full-width
- The `<Phone />` preview is **not** rendered (desktop-only, decorative)

The `<Phone />` mockup (Clients.html:4355–4486) is a mobile **dashboard** layout, not a mobile clients view. On real mobile, the production responsive layout of `/clients` replaces it; the two are never both rendered.

## Implementation order

1. **Page shell** — `/clients` route, sidebar + topbar reuse, empty `<ClientsPage>` placeholder.
2. **`<ClientsHero />`** + **`<LoopBar />`** — both static text + a CTA each. The LoopBar's "Open the loop" button links to `/assistant` (the LoopBar avatars are decorative for v1; real avatars come from the agents module).
3. **`<ClientsToolbar />`** — search input + filter chips (filter state lives in URL `?filter=&q=`).
4. **`<ClientCard />`** — start with the resting state (mood band + avatar + name + segment + story line + foot row). Get the gradient/mood logic right first; the narrative copy is editorial.
5. **`<ClientsCards />`** — grid container; wire the expand/collapse panel state (`openId`).
6. **`<ClientCard>` panel state** — slide-up detail panel (phone / email / address + Message / Open card buttons). Esc + outside-click close.
7. **`<TopClients />`** + **`<ClientsSegments />`** — both static-ish data; needs the new `/analytics/clients/*` endpoints.
8. **`<PhoneClients />`** — last; decorative.
9. **Stop here for v1.** `<TodayLoop />` is defined but not mounted in the prototype's `ClientsPage`; do not build it unless the design re-introduces it.

## What NOT to port

- The `<div class="stage">` browser chrome (Clients.html:4500).
- The `<div class="annot">` "Desktop · 1240 × 1040" / "Mobile · 380 × 760" labels (Clients.html:4530–4543).
- `TweaksPanel`, `useTweaks`, `TWEAK_DEFAULTS` (dev tools).
- `window.LOGO_DATA_URL` — use `static/logo-monster.png`.
- The **older `.ph/.ccard/.cstrip/.cside/.csegment` (no `2`) CSS block** at lines 2301–2934 — these are stale styles for an earlier card design. The live components use `*2` selectors.
- The `<TodayLoop />` component **at v1** — defined but unmounted in the prototype's `ClientsPage`. Documented separately in case a later iteration revives it.
- The `STORIES` editorial copy — these are mock narratives. Production must derive them from the agents module or fall back to deterministic captions (see "Per-card derived fields" above).

## Conventions for this folder

Same as `pages/landing/`, `pages/dashboard/`, and `pages/assistant/`. Code blocks are verbatim from the prototype; the Preact translation is in a separate sub-section per component file. Each `[DEFERRED]` or `defined-but-unused` component file starts with a one-line warning blockquote so it can be skimmed quickly.

## Cross-reference (CSS selector → component)

For the underlying styles, the prototype's CSS (Clients.html inline `<style>` lines 264–3023) defines:

| Selector family | Component |
|---|---|
| `.ph2`, `.ph2__crumb`, `.ph2__crumb-dot`, `.ph2__title`, `.ph2__sub`, `.ph2__cta` | clients-hero |
| `.loopbar`, `.loopbar__title`, `.loopbar__lbl`, `.loopbar__lbl-dot`, `.loopbar__h`, `.loopbar__avs`, `.loopbar__av`, `.loopbar__av-meta`, `.loopbar__cta` | loop-bar |
| `.clay2` | (root layout — defined here, used in root.md only) |
| `.ctoolbar2`, `.ctoolbar2__search`, `.ctoolbar2__filters`, `.ctoolbar2__filter`, `.ctoolbar2__filter--active`, `.ctoolbar2__filter-count`, `.ctoolbar2__sort` | clients-toolbar |
| `.ccards2`, `.ccard2`, `.ccard2--open`, `.ccard2__mood`, `.ccard2__mood-tex`, `.ccard2__since*`, `.ccard2__status*`, `.ccard2__crown`, `.ccard2__av*`, `.ccard2__body`, `.ccard2__name`, `.ccard2__seg*`, `.ccard2__story`, `.ccard2__foot`, `.ccard2__nudge*`, `.ccard2__bal*`, `.ccard2__panel*` | client-card |
| `.cside2` | (root sidebar wrapper — defined in root.md, used by TopClients + ClientsSegments) |
| `.ctop2`, `.ctop2__head`, `.ctop2__title`, `.ctop2__period`, `.ctop2__list`, `.ctop2__item`, `.ctop2__rank`, `.ctop2__rank--1`, `.ctop2__name`, `.ctop2__bar-wrap`, `.ctop2__bar`, `.ctop2__amt` | top-clients |
| `.csegment2`, `.csegment2__title`, `.cseg2-row`, `.cseg2-row__lbl`, `.cseg2-row__bar`, `.cseg2-row__fill`, `.cseg2-row__num` | clients-segments |
| `.cloop`, `.cloop__head`, `.cloop__title`, `.cloop__title-dot`, `.cloop__count`, `.cloop__sub`, `.cloop__row`, `.cloop__avatar`, `.cloop__name`, `.cloop__why`, `.cloop__draft`, `.cloop__btns`, `.cloop__btn--{send,edit}` | today-loop |
| `.phone__*`, `.phero*`, `.pkpi*`, `.pjob*`, `.psection-*`, `.ptab*`, `.home-indicator` | phone-preview-clients (shared with dashboard's phone-preview where identical) |

## Shared primitives needed (in addition to dashboard's)

| Primitive | Where defined | Reused by |
|---|---|---|
| `<I d={...} size={...} sw={...}/>` icon component | Clients.html:3465–3469 (identical to dashboard) | every visual element with an icon |
| `ICN.{search,send,plus,crown,x,phone,mail,pin,msg,eye,arrow,bell,signal,wifi,battery,home,invoice,user}` | Clients.html:3471–3509 (identical to dashboard) | this page + dashboard + assistant |
| `Sidebar`, `Topbar`, `ActivityTicker` | Clients.html:3522–3677 (identical to dashboard) | reuse `pages/dashboard/components/{sidebar,topbar,activity-ticker}.md` |

No new primitives are introduced by this page beyond CSS — `moodFor()`, `daysSinceContact()`, `STORIES`, `STATUS_LABELS` are all data helpers documented inside `components/client-card.md`.
