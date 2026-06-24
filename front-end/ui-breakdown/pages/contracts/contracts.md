# Page — /contracts

The contractor's signed-work board: "everything you've committed to." Hero
(Σ committed value + deposits line), 4 KPI cards, a dark-teal 30-day **schedule
strip** (Gantt-style lane chart), and up to four collapsible pipeline **tracks**
(In progress / Starting soon / Wrapping up / Drafts) of flippable contract
cards. Cards are grouped by a server-derived `mood`.

Source route: `routes/contracts/index.tsx` → `js/index.tsx`.

## App-shell composition (island order)

```
<div class="app">
  <DashSidebar active="contracts" />            ← shared island
  <main class="main">
    <DashTopbar greetingDate={…} greetingName={…} />  ← shared island
    <div class="content">
      <ContractsPage />                          ← page island (whole body)
    </div>
  </main>
</div>
```

- Same shell as /quotes. Difference: this route passes **both** `greetingDate`
  (localized "weekday · month day", computed SSR from `new Date()`) **and**
  `greetingName` to DashTopbar; /quotes passes only `greetingName`.
- `ContractsPage` is the only page-local island.

## `<Head>`

- **title:** `tFor(lang, "contractsPage.docTitle")` — **localized** (contrast
  with /quotes' hard-coded title).
- **CSS:** two `<link>` tags, in order:
  1. `/dashboard.css` (key `css-dashboard`) — tokens + shell + skeletons.
  2. `/contracts.css` (key `css-contracts`) — all contracts classes (copied to
     `css/contracts.css`).

## SSR data

**None for the body.** The route computes `greetingName` + `greetingDate` from
`ctx.state.user` + the current date. All contract/customer/quote data is fetched
**client-side** by `ContractsPage` on mount; the server ships shell + skeleton.

## Sections (top → bottom, all inside ContractsPage)

1. **ContractsHero** (`.kph`) — eyebrow ("Work in flight · N contracts"), big
   headline (Σ committed), deposits sub-line, "Schedule a job" CTA (an `<a>` to
   `/assistant?seed=…`). Empty variant when nothing live.
2. **ContractsKpis** (`.kkpi`) — 4 cards: In progress (accent), Starting soon,
   Wrapping up, Closed this month.
3. **ScheduleStrip** (`.csched`) — dark gradient panel, 5 week rows, lane-packed
   contract bars positioned by day-of-month coordinate, "TODAY" marker, legend.
   Honest-empty slate when no bars in range.
4. **Tracks** — single stacked column (NO sidebar, unlike /quotes):
   - 01 In progress → `.kcards` of `ContractCard`, or `.kempty` slate.
   - 02 Starting soon → `.kcards` / `.kempty`.
   - 03 Wrapping up → `.kcards` / `.kempty`.
   - 04 Drafts → `.kcards` — **only rendered when `drafts.length > 0`** (no track
     element at all otherwise; no empty slate).

## Build order

1. Tokens + `/dashboard.css` shell, shared Skeletons.
2. `lib/contracts-shape.ts` adapter (`toContractCard`, `moodFor`) — the data
   projection every card/strip consumes. (Not a UI component; a dependency.)
3. `contract-track/` (island; collapse mechanic — a contracts-specific twin of
   shared QuoteTrack).
4. `contracts-sections/` (page-composition; hero/kpi/schedule-strip + `.kempty`).
5. `contract-card/` (island; flip card with milestone synthesis).
6. `contracts-page/` (island; fetch 3 endpoints + group by mood + compose).
7. Route shell `index.tsx`.

## Local components (this folder)

| folder | source | bucket |
|---|---|---|
| `contracts-page/` | `islands/ContractsPage.tsx` | island (data/orchestrator) |
| `contracts-sections/` | `components/ContractsSections.tsx` | page-composition (SSR) |
| `contract-card/` | `islands/ContractCard.tsx` | island (client-only flip) |
| `contract-track/` | `islands/ContractTrack.tsx` | island (collapse) |

Shared (reference only, do NOT re-spec): `DashSidebar`, `DashTopbar`,
`Skeletons`, `dash-icons`. **`components/contract-doc.tsx`** is a shared
public-surface component owned by another agent — NOT spec'd here (the
`/c/[id]` public route, not /contracts).

## Page-level anti-pattern (see contracts-page/ for detail)

`ContractsPage` is a **whole-page island**: it fetches `/contracts` + `/clients`
+ `/quotes` on mount, derives moods via `toContractCard`, and freezes the result.
The card CTAs mutate navigation via `globalThis.location.assign(...)` (full
navigations, not client routing). No `location.reload()` on this page (contracts
have no delete-from-list button), so it is *less* exposed than /quotes — but the
frozen-SSR-props pattern still applies. Detail + Partial fix in
`contracts-page/contracts-page.md` §1.
