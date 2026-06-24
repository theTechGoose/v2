# Page — /quotes

The contractor's quote pipeline: a "where does every open quote stand right
now" board. Hero headline (Σ open value + stale count), 4 KPI cells, three
collapsible pipeline **tracks** (Out for response / Drafting / Decided this
month) of flippable quote cards, and a sticky right sidebar (top quotes by
value, win-rate gauge, AI tip).

Source route: `routes/quotes/index.tsx` → `js/index.tsx`.

## App-shell composition (island order)

The route is an `define.page` SSR shell. It renders the standard authed
app-shell and mounts exactly one data island:

```
<div class="app">
  <DashSidebar active="quotes" />          ← shared island
  <main class="main">
    <DashTopbar greetingName={…} />        ← shared island
    <div class="content">
      <QuotesPage />                        ← page island (the whole page body)
    </div>
  </main>
</div>
```

- **DashSidebar / DashTopbar** are shared (see `shared-components/`). The route
  passes `active="quotes"` and a first-name `greetingName` (localized "there"
  fallback). `MobileViewport` / `ImpersonationBanner` are part of the global
  layout (`routes/_app` / `_layout`), not mounted here.
- `QuotesPage` is the only page-local island; everything below the topbar is
  its subtree.

## `<Head>`

- **title:** `Quotes · Paperwork Monster` (hard-coded literal in the route —
  NOT localized via `tFor`, unlike /contracts which uses
  `contractsPage.docTitle`).
- **CSS:** two `<link>` tags, in order:
  1. `/dashboard.css` (key `css-dashboard`) — tokens + app-shell + skeleton +
     `.app/.main/.content` chrome.
  2. `/quotes.css` (key `css-quotes`) — all quotes-page classes (copied to
     `css/quotes.css`).

## SSR data

**None for the body.** The route computes only `greetingName` from
`ctx.state.user` (name + language). All quote/analytics data is fetched
**client-side** by the `QuotesPage` island on mount — the server ships an empty
shell + skeleton. (`user.language` decides the SSR `lang` seed but QuotesPage
ignores the prop and reads `langSignal.value` live.)

## Sections (top → bottom, all inside QuotesPage)

1. **QuotesHero** (`.qph`) — eyebrow, big headline, sub, pink "+ New quote" CTA.
   3 copy variants: empty / all-warm / has-stale.
2. **QuotesKpis** (`.qkpi`) — 4 cells: Out for response (accent), Drafting,
   Decided, Win rate (gated <5 decided → "—").
3. **`.qlay`** two-column grid (`1fr 320px`, collapses at 1200px):
   - **left:** three `QuoteTrack` [shared] groups:
     - 01 Out for response → `.qcards` of `QuoteCard` (sorted opened>sent>cooling>stale)
     - 02 Drafting → `.qcards` of `QuoteCard`
     - 03 Decided this month → `.qdone` of `DecidedRow` (with inline DeleteQuoteButton icon)
   - **right:** `<aside class="qside">` sticky → QSideBig, QSideRate, QSideTip.

## Build order

1. Tokens + `/dashboard.css` shell (`.app/.main/.content`), shared Skeletons.
2. `quote-track/` [shared — reference only] — the collapse mechanic.
3. `quotes-sections/` (page-composition; SSR markup for hero/kpi/decided/sidebar).
4. `delete-quote-button/` (island; used by DecidedRow + QuoteCard).
5. `quote-card/` (island; flip card).
6. `quotes-page/` (island; fetch + group + compose all of the above).
7. Route shell `index.tsx` (Head + app-shell + `<QuotesPage/>`).

## Local components (this folder)

| folder | source | bucket |
|---|---|---|
| `quotes-page/` | `islands/QuotesPage.tsx` | island (data/orchestrator) |
| `quotes-sections/` | `components/QuotesSections.tsx` | page-composition (SSR) |
| `quote-card/` | `islands/QuoteCard.tsx` | island (client-only flip) |
| `delete-quote-button/` | `islands/DeleteQuoteButton.tsx` | island (mutation) |

Shared (reference only, do NOT re-spec): `DashSidebar`, `DashTopbar`,
`QuoteTrack`, `Skeletons`, `dash-icons` (`I`/`ICN`).

## Page-level anti-pattern (see quotes-page/ for detail)

`QuotesPage` is a **whole-page island** that fetches on mount and freezes the
result in `useState`. `DeleteQuoteButton` mutates then calls
`globalThis.location.reload()` — a full-document reload to reflect a delete,
which re-runs SSR + re-fetches everything. Flagged; PRG/Partial fix proposed in
`quotes-page/quotes-page.md` §1 and `delete-quote-button/`.
