# Clients

## Purpose
Roster of every client on the books, presented as a magazine-style card grid with editorial copy ("The twelve people who keep the lights on"). Surfaces who you owe a check-in to (the "loop"), filters by state, and shows leaderboard / segmentation in a side rail.

## Top-level structure
Same `.stage` → `.window` → `.app` → `.main` (sidebar + topbar + content) shell as the dashboard. Inside `.content` the page renders `<ClientsPage>`, which composes:

1. **`<ClientsHero>`** — `.ph2` page header with crumb, big editorial title, and stats.
2. **`<LoopBar>`** — `.loopbar` strip showing the "today's loop" of friendly check-ins to send.
3. **`<ClientsToolbar>`** — `.ctoolbar2` with search, filter chips, and sort.
4. **`.clay2`** two-column layout:
   - `<ClientsCards>` — `.ccards2` grid of `.ccard2` editorial cards.
   - `.cside2` rail with `<TopClients>` (`.ctop2`) + `<ClientsSegments>` (`.csegment2`).

## Layout chrome (uses `shared/`)
- `shared/sidebar`, `shared/topbar`, `shared/annotation-dots`, `shared/phone-preview`.
- KPI/job/panel pieces from `shared/` are not used directly — Clients uses its own page-header (`.ph2`) and side-panel cards.

## Page-unique components
- [client-card-2](components/client-card-2/) — `.ccard2__*` editorial card with avatar, mood swatch, balance, story line, footer CTA + balance, and an expandable detail panel.
- [client-loop](components/client-loop/) — `.cloop__*` daily-loop list of drafted check-ins (uses `LoopBar` style markers as well — see notes).
- [client-segment-bar](components/client-segment-bar/) — `.csegment2__*` aggregate "who's on your books" stacked bar.
- [client-toolbar](components/client-toolbar/) — `.ctoolbar2__*` filter chips + sort.
- [client-top-summary](components/client-top-summary/) — `.ctop2__*` leaderboard card.

## Notable interactions
- Clicking a `.ccard2` toggles an expandable `.ccard2__panel` (stop-propagation on inner panel). See client-card-2 for state.
- `.csegment2` and `.ctop2` are static read-only summaries (no animations, no interactivity in the export).
- Toolbar search filters the `CLIENTS` list in-memory by name / contact / phone; filter chips partition by status.
- Page header crumb dot (`.ph2__crumb-dot`) uses the `pulse` keyframe (pink ripple).

## Source
`extracted/Paperwork Monsters Clients.html` (also at `pages/clients/raw.html`).
