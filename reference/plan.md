# Frontend Plan — Bring `/clients` and `/quotes` into Production

## Context

The reference design for two new pages has landed under `reference/pages/clients/` and `reference/pages/quotes/`. The backend engineer is concurrently extending `Customer`/`Quote` DTOs and adding a small `/analytics/clients/*` and `/analytics/quotes/*` rollup. Frontend goal: stand up both pages in `front-end/` mirroring the existing `/dashboard` conventions so they render meaningfully against seed data today and naturally swap to live data as backend endpoints come online — same "seed-first, wire-as-it-lands" pattern `routes/dashboard/index.tsx` already uses.

Both pages are auth-gated and reuse the dashboard chrome (`DashSidebar`, `DashTopbar`). Per the reference root.md files, the prototype CSS at `reference/paperwork-monsters/project/Paperwork Monsters {Clients,Quotes}.html` is the canonical source for visual rules; we port the relevant `*2`/`q*` selector blocks into per-route CSS files.

## Conventions to follow (from dashboard)

- **Route layout**: `routes/{page}/index.tsx` for the page, `routes/{page}/_middleware.ts` for the auth gate.
- **Auth gate**: copy `routes/dashboard/_middleware.ts` verbatim — `loadUser(ctx.req)` → 302 to `/` if absent → `ctx.state.user = user`.
- **Page handler**: `define.page(async (ctx) => { ... })` from `utils.ts`. Use `getSessionId(ctx.req)` and `Promise.all([...].map(p => settle(p, fallback)))` so a single failing endpoint never crashes the page.
- **Chrome**: import `DashSidebar` (pass `active="clients"` / `active="quotes"`) and `DashTopbar` directly into the route. Do not introduce `AppNav.tsx`/`AppSidebar.tsx` — they exist but are unused.
- **CSS**: per-route file under `static/` linked via `<Head><link rel="stylesheet" href="/{page}.css" /></Head>`. BEM-like classes; inline `style` only for dynamic colors/widths/gradient stops.
- **Icons**: reuse `lib/dash-icons.tsx` — all icons needed (`crown`, `eye`, `send`, `plus`, `search`, `chev`, `bell`, `phone`, `mail`, `pin`, `msg`, `arrow`, `check`, `x`) are already in the `ICN` map.
- **API**: HTTP client per page under `clients/{page}.ts`, exporting a typed `pageClient` object on top of `lib/api.ts`. Permissive `Record<string, unknown>` field bag on response interfaces — the backend owns the canonical schema.
- **Seeds**: typed exports under `lib/{page}-seed.ts` mirroring `lib/dash-seed.ts` (plain typed arrays, no factories). Used as `settle()` fallbacks until real endpoints land.
- **Server vs island**: pure-render → `components/{Page}Sections.tsx`. Anything with state (expand/collapse, flip, search input, filter chips) → `islands/`.

## Files to create

### `/clients`

| Path | Kind | Purpose |
|---|---|---|
| `front-end/routes/clients/_middleware.ts` | middleware | Auth gate (verbatim copy of `routes/dashboard/_middleware.ts`) |
| `front-end/routes/clients/index.tsx` | page | Composes hero / loop bar / toolbar / cards grid / right rail |
| `front-end/clients/clients.ts` | http client | `clientsClient.list({ filter, q })`, `.top({ period, limit })`, `.segments()`, `.byId(id)` |
| `front-end/lib/clients-seed.ts` | seed | `SEED_CLIENTS`, `SEED_TOP_CLIENTS`, `SEED_SEGMENTS`, `SEED_LOOP_DRAFTS` typed exports |
| `front-end/components/ClientsSections.tsx` | server | `<ClientsHero/>`, `<LoopBar/>`, `<TopClients/>`, `<ClientsSegments/>` |
| `front-end/islands/ClientsToolbar.tsx` | island | Search input + filter chips + sort button. URL params `?filter=&q=` (preferred over local state per root.md). |
| `front-end/islands/ClientsCards.tsx` | island | Grid + single-open coordinator (`openId` signal, Esc + outside-click close). Renders the `<ClientCard>` body per row. |
| `front-end/static/clients.css` | css | Port `.ph2`, `.loopbar`, `.ctoolbar2`, `.ccards2`, `.ccard2*`, `.clay2`, `.cside2`, `.ctop2`, `.csegment2` selector blocks from `Clients.html` lines 1748–2299 + 2935–3000 |

### `/quotes`

| Path | Kind | Purpose |
|---|---|---|
| `front-end/routes/quotes/_middleware.ts` | middleware | Auth gate (verbatim copy) |
| `front-end/routes/quotes/index.tsx` | page | Composes hero / KPIs / 3 tracks / right rail |
| `front-end/clients/quotes.ts` | http client | `quotesClient.list()`, `.opens(id)`, `.winRate({ days })`, `.insight()` |
| `front-end/lib/quotes-seed.ts` | seed | `SEED_QUOTE_PIPELINE` (with `stage`, `daysIn`, `opens`, `sentDays`), `SEED_DECIDED`, `SEED_BIG`, `SEED_WIN_RATE`, `SEED_TIP` |
| `front-end/lib/quotes-mood.ts` | helper | `moodForQuote(q)` (gradient/shadow per stage, `opened_hot` synthetic state when `stage==='opened' && opens >= 3`); `readingFor(q, opens)` 5-rule reading line. Pure functions, shared by server + island. |
| `front-end/lib/format.ts` | helper | Promote `fmtMoney` from inline; reused by quotes + likely future pages (per `quotes/root.md` shared-primitives note) |
| `front-end/components/QuotesSections.tsx` | server | `<QuotesHero/>`, `<QuotesKpis/>`, `<DecidedRow/>`, `<QSideBig/>`, `<QSideRate/>`, `<QSideTip/>` |
| `front-end/islands/QuoteTrack.tsx` | island | Collapsible Track with chevron animation + `localStorage["quotes:tracks:open"]` persistence |
| `front-end/islands/QuoteCard.tsx` | island | Flip front↔back, lazy-load opens timeline on first flip, render reading line + 3 action buttons |
| `front-end/static/quotes.css` | css | Port `.qph`, `.qkpi`, `.qtrack*`, `.qcards`, `.qcard*`, `.qdone*`, `.qside*`, `.qbig*`, `.qrate*`, `.qlay` from `Quotes.html` lines 1748–2380 |

## Files to reuse (do not modify)

- `front-end/islands/DashSidebar.tsx` — already accepts `active?: string`; we just pass `"clients"` or `"quotes"`.
- `front-end/islands/DashTopbar.tsx` — drop in unchanged.
- `front-end/lib/api.ts` — `api.get<T>(path, { sessionId, query })`.
- `front-end/lib/auth.ts` — `getSessionId`, `loadUser`.
- `front-end/lib/dash-icons.tsx` — `I` + `ICN` map. Verify `crown`, `eye`, `phone`, `mail`, `pin` are present; if any are missing, append rather than fork.
- `front-end/utils.ts` — `define.page`, `define.middleware`.

## Implementation order

Builds bottom-up so each PR is shippable on its own. Group as marked.

**PR 1 — Clients shell + static rail**
1. `routes/clients/_middleware.ts` (copy from dashboard).
2. `clients/clients.ts` + `lib/clients-seed.ts`.
3. `routes/clients/index.tsx` rendering chrome + empty content well.
4. `components/ClientsSections.tsx`: `<ClientsHero/>` + `<LoopBar/>` + `<TopClients/>` + `<ClientsSegments/>` (all static, fed by seed via `settle()`).
5. `static/clients.css` — port hero/loopbar/cside/ctop2/csegment2 selectors first (everything except cards).

**PR 2 — Clients cards + toolbar**
6. `islands/ClientsToolbar.tsx` — search + filter chips, URL params `?filter=&q=` (preferred over local state per `clients/root.md`). Sort menu deferred (per `clients-toolbar.md`).
7. `islands/ClientsCards.tsx` — grid + single-open coordinator + `<ClientCard>` (mood derivation table from `client-card.md`: VIP teal → `balance>0` pink → `active` green → `lead` coral → `cold` coffee → sage). Slide-up panel with phone/email/address + Message/Open buttons. Esc + outside-click close.
8. `static/clients.css` — port `.ccards2/.ccard2*` blocks.

**PR 3 — Quotes shell + sidebar widgets**
9. `routes/quotes/_middleware.ts` (copy).
10. `clients/quotes.ts` + `lib/quotes-seed.ts` + `lib/quotes-mood.ts` + `lib/format.ts`.
11. `routes/quotes/index.tsx` rendering chrome + hero + KPIs.
12. `components/QuotesSections.tsx`: `<QuotesHero/>`, `<QuotesKpis/>`, `<DecidedRow/>`, `<QSideBig/>`, `<QSideRate/>` (half-donut: `r=42`, half-circumference `π·42`, `stroke-dasharray` derived from win-rate pct), `<QSideTip/>`.
13. `static/quotes.css` — port qph/qkpi/qside/qbig/qrate selectors.

**PR 4 — Quotes pipeline (tracks + cards)**
14. `islands/QuoteTrack.tsx` — collapsible group, Track 1 open by default, `localStorage["quotes:tracks:open"]` persistence keyed by track number.
15. `islands/QuoteCard.tsx` — flip state per card (multiple cards can flip simultaneously per `quotes/root.md`); front face = mood band + numeral + status pill + opens chip + body + foot; back face = opens timeline + reading line (call `readingFor` from `lib/quotes-mood.ts`) + Resend / Copy link / Preview buttons. Lazy-fetch `quotesClient.opens(id)` on first flip; fall back to seed.
16. `static/quotes.css` — port `.qtrack*/.qcards/.qcard*/.qdone*` blocks. Address the prototype's missing `.qcard__opens-dot{,s}` styles (per `quotes/root.md` line 211): suggest 5px circles, white at 30%/80% alpha for off/on. If we'd rather keep it tight, drop dots and keep only the count — pick once, comment in CSS.

**PR 5 — Wire real endpoints (incremental, as backend lands)**
17. Replace seed fallbacks one endpoint at a time inside the `settle()` calls in each route. Order suggested by backend availability: `GET /clients` (exists) → derived per-card fields → `/analytics/clients/{top,segments}` (NEW) → `GET /quotes` (exists, needs `stage`/`opens`/`daysIn` extension) → `/quotes/:id/opens` (NEW) → `/analytics/quotes/{win-rate,insight}` (NEW). Each switch is a one-line diff per call.

## Deferred (do not build at v1)

- `<TodayLoop/>` — defined but not mounted in the prototype's `ClientsPage`; build only if a future iteration revives it (`clients/root.md` step 9).
- `<PhoneClients/>` and `<PhoneQuotes/>` — desktop-only decorative iPhone mockups. Skip; production responsive layout already replaces them on real mobile.
- Sort menu in `<ClientsToolbar/>` — markdown calls it deferred.
- Hard-coded `+8 pts vs Q1` win-rate delta — drop until analytics rollup supports it (`quotes/root.md` "What NOT to port").

## Backend handoff notes (for the other engineer)

The plan assumes these endpoints exist or will:

- `GET /clients` returning derived per-customer fields: `last`, `lastWhen`, `lastTone`, `balance`, `balanceSub`, `jobs`, `jobsSub`, `status`, `temp`, `vip`, `daysSinceContact`. Defined in `clients/root.md` "Per-card derived fields".
- `GET /clients/:id` returning the full customer detail (existing).
- `GET /analytics/clients/top?period=12mo&limit=5` — NEW.
- `GET /analytics/clients/segments` — NEW.
- `GET /quotes` extended with `stage` (`'draft'|'sent'|'opened'|'cooling'|'stale'|'won'|'lost'`), `daysIn`, `opens`, `sentDays`, `decidedDays`. Stage definitions in `quotes/root.md` "Stage definitions".
- `GET /quotes/:id/opens` returning `[{ at: ISOString, device, ip? }]` — NEW.
- `GET /analytics/quotes/win-rate?days=90` returning `{ won, lost, decided }` — NEW.
- `GET /analytics/quotes/insight` returning a single insight object — NEW (hard-coded fallback OK for v1).

Frontend tolerates all of these being absent: every call is wrapped in `settle()` with a seed fallback so the page is never blocked on backend availability.

## Verification

End-to-end smoke test once each PR lands:

1. `cd front-end && deno task start` (or whatever `deno.json` defines) and load `http://localhost:8000/clients` and `/quotes` after signing in.
2. `/clients` golden path: hero renders → loop bar visible → toolbar filter chips switch the visible cards → click a card → contact panel slides up → Esc closes → URL reflects `?filter=` and `?q=` after toolbar interaction → right rail (TopClients + Segments) renders.
3. `/quotes` golden path: hero renders → 4 KPIs visible → Track 1 open by default, Tracks 2/3 collapsed → toggle a track → its open state survives a reload (`localStorage`) → click a quote card → flips to back → opens timeline + reading line render → flip back → multiple cards can be flipped at once → right rail (QSideBig + half-donut + tip) renders.
4. Responsive: resize through 1200px → 1100px → 768px and confirm grid collapses match the breakpoints in each root.md ("Mobile breakpoints" sections).
5. Auth: hit both routes signed-out → 302 to `/`.
6. Backend tolerance: temporarily break the API base URL and confirm both pages still render via seed fallbacks (no white-screen).
7. Sidebar active state: confirm `active="clients"` highlights Clients in the sidebar nav, same for quotes.

No automated tests for these pages in v1 — the dashboard has none either; mirror that until a frontend test harness lands.

## Critical files to reference while implementing

- `front-end/routes/dashboard/index.tsx` — composition pattern + `settle()` + `Promise.all`.
- `front-end/routes/dashboard/_middleware.ts` — auth gate (copy verbatim).
- `front-end/components/DashSections.tsx` — server-component conventions, BEM classes, inline-style usage.
- `front-end/islands/DashSidebar.tsx`, `front-end/islands/DashTopbar.tsx` — chrome reuse.
- `front-end/lib/dash-seed.ts` — seed shape to mirror for `clients-seed.ts` and `quotes-seed.ts`.
- `front-end/clients/dashboard.ts` — HTTP client shape to mirror.
- `reference/pages/clients/components/client-card.md` — mood derivation rules + panel state.
- `reference/pages/quotes/components/quote-card.md` — mood derivation, reading-line rules, flip behavior.
- `reference/paperwork-monsters/project/Paperwork Monsters Clients.html` lines 1748–2299, 2935–3000 — CSS source.
- `reference/paperwork-monsters/project/Paperwork Monsters Quotes.html` lines 1748–2380 — CSS source.
