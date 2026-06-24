# DashSections

The **page-composition** module for `/dashboard`. A single SSR file
(`components/DashSections.tsx`) that exports the section blocks
`DashboardPage` assembles into the page body: `Kpis`, `ActiveJobs`,
`QuotesAwaiting`, `Outstanding`, `Activity` — plus a now-dead `Hero` export.
None of these are islands themselves; they are pure presentational functions
rendered server-side from rows the `DashboardPage` island has already mapped.
The only client-side motion inside them is the embedded `<Ticker/>` island
(money count-up).

## 1. Classification & behavior
- **Bucket:** `page-composition` — a bag of section components, not a single
  rendered unit. File lives at `components/DashSections.tsx` (a plain component
  module, NOT under `islands/`).
- **Interaction tier:** **static SSR** for every block. They take fully-mapped
  props and emit markup. There is **no `useState`, no `useEffect`, no fetch**
  here — `DashboardPage` (the island) owns all data + lifecycle and passes rows
  down. The only interactive descendant is the `<Ticker/>` island
  (`.money__amt` in `Outstanding`, `.hero__title em` in the dead `Hero`).
- **Server mutations:** NONE. The "Nudge by text" / "View quote" / "Nudge all"
  buttons are **inert** `<button type="button">` with **no `onClick`** — visual
  affordances only (roadmap TODO). FLAG: they look actionable but do nothing
  yet; a rebuild must either wire them or down-rank them to avoid a dead-click.
  No form, no PRG, no flash.
- **`location.reload()`:** none. ✅
- **Data source per region:** all data arrives as **props** from `DashboardPage`
  (which fetches via `clients/dashboard.ts` + `clients/quotes.ts` and maps DTOs
  to the row types below). DashSections never touches `clients/*` or
  `lib/dash-cache.ts` directly. The static fallback values
  (`lib/dash-seed.ts`: `SEED_KPIS`, `SEED_JOBS`, `SEED_QUOTES`,
  `SEED_OUTSTANDING`, `SEED_ACTIVITY`) seed the same prop shapes when the
  backend hasn't answered.
- **Honest-empty (per block, all internal):**
  - `ActiveJobs` — `jobs.length === 0` → empty copy
    (`activeJobs.empty.text`) + a "See pipeline →" CTA to `/quotes`.
  - `QuotesAwaiting` — `quotes.length === 0` → one-liner
    (`quotesAwaiting.empty`), and the count pill is suppressed.
  - `Outstanding` — `allZero` (`current+mid+overdue === 0 && owed === 0`) hides
    the bar/legend and shows `outstanding.empty.noInvoices` (no rows) or
    `outstanding.empty.allPaid` (rows exist but settled); the "Nudge all"
    button is suppressed.
  - `Activity` — `items.length === 0` swaps the header sub
    (`activity.emptySub` vs `activity.busySub`); the feed simply renders no rows.
  - `Kpis` — never structurally empty (always 4 tiles); `avgJob` shows
    `kpis.avgJob.none` ("No paid jobs yet") instead of `$0`, and Outstanding is
    clamped to `$0` by `DashboardPage.pickKpis` when `pending === 0`.
- **Liveness:** request-response, render-once from props. No polling, no
  `setInterval`, no websocket. (`<Ticker/>` runs one rAF count-up on mount.)
- **i18n:** every string flows through `tFor(lang, …)`; a `plural()` helper
  resolves `.one`/`.other` for SSR call sites (frontend `tn` is langSignal-only
  and can't honor an explicit lang). `lang` is threaded as a prop from
  `DashboardPage` (which reads `langSignal.value`).
- **Data-shape hazards:**
  - `QuotesAwaiting` derives its total by **string-parsing the formatted amount
    back to a number** (`Number(q.amt.replace(/[^0-9.]/g,""))`) — fragile if the
    formatter ever emits non-`$1,234` shapes (e.g. `k` suffix); it would
    mis-sum.
  - `Outstanding` uses `total = realTotal || 1` to avoid divide-by-zero in the
    bar segment widths.
  - `Activity` injects `a.html` via `dangerouslySetInnerHTML` — trusted,
    server-derived + `escapeHtml`'d in `DashboardPage` (the `· N×` dupe badge is
    appended as trusted markup). No user input reaches it unescaped.
  - `ActiveJobs` shows `total ?? jobs.length` as the header count so the badge
    matches the "Active jobs" KPI even though only the top slice renders.

## 2. Anatomy
```
DashSections.tsx exports (composed by DashboardPage in this order):
  <Kpis>                                  ← section.kpis
    .kpi × 4 { .kpi__icon, .kpi__label, .kpi__val, .kpi__delta[--up|warn|neutral] }
  <div class="grid">
    <ActiveJobs>                          ← .panel
      .panel__head { dot · .panel__title · .panel__count · a.panel__action "See all →" }
      empty → copy + a.panel__action "/quotes"
      else  → .job × n { .job__icon · title/meta/.job__progress · .job__amount }
    <QuotesAwaiting>                       ← .panel
      .panel__head { .panel__title · .panel__count(coffee) · a.panel__action "/quotes" }
      empty → .quotesAwaiting.empty line
      .quote-item × n { client/amt row · sub(hot 🔥 / cold) · .quote-item__cta(2 inert qbtn) }
  <div class="grid">
    <Activity id="activity">               ← .panel
      .panel__head { title · busy/empty sub · a.panel__action "/activity" }
      .activity-item × n { .activity-item__icon · dangerouslySetInnerHTML · time }
    <Outstanding>                          ← .money (NOT .panel)
      .money__head { .money__label · .money__amt → $<Ticker value={owed}/> · inert "Nudge all" }
      allZero → empty line; else → .money__bar(3 segs) + .money__legend(3)
      items → dashed-top list of {client · meta · amount}

DEAD export <Hero> (.hero*, .btn*) — no importer renders it; replaced by the
  .assistant-cta banner in DashboardPage. Still embeds <Ticker/> in .hero__title em.
  The `.hero` box IS reused by the DashboardSkeleton (see dashboard-page.css).
```
- **Slots/children:** none — each block is self-composed from its row props.
- **Icon dependency:** `lib/dash-icons.tsx` (`I` renderer + `ICN` map). KPIs use
  `hardhat/invoice/quote/trend`; jobs use the row's `icon`
  (`hardhat/wrench/truck/paint/ruler`); quotes/outstanding use `send/eye`;
  activity uses `send/check/contract/card/invoice/msg/sparkle`. (Already copied
  into `shared-components/dash-sidebar/js/dash-icons.tsx`.)
- **Ticker dependency:** imports `islands/Ticker.tsx` — see the `ticker/` spec.

## 3. Props
Per exported block (all SSR, none are signals — `lang` is threaded, not read):

**Kpis** `KpisProps`
| name | type | default | control | signal? |
|---|---|---|---|---|
| `activeJobs` | number | — | number | no |
| `outstanding` | number (dollars) | — | number | no |
| `outstandingCount` | number | — | number | no |
| `outstandingOverdue` | number | — | number | no |
| `pendingQuotes` | number | — | number | no |
| `pendingTotal` | number (dollars) | — | number | no |
| `avgJob` | number (dollars, 0 ⇒ "none") | — | number | no |
| `lang` | `"en"\|"es"` | `"en"` | select | no |

**ActiveJobs** `{ jobs: JobRow[]; total?: number; lang? }`
**QuotesAwaiting** `{ quotes: QuoteRow[]; lang? }`
**Outstanding** `{ owed, current, mid, overdue: number; items: OutstandingRow[]; lang? }`
**Activity** `{ items: ActivityEntry[]; lang? }`
**Hero (DEAD)** `{ thisMonthBilled, pendingQuotes: number; outstandingOverdue?; lang? }`

Row types (from source): `JobRow{client,task,amount,paid,pct,due,icon,color,status{kind,txt}}`,
`QuoteRow{client,desc,amt,sent,hot?,cold?}`,
`OutstandingRow{client,meta,metaColor,metaWeight,amount}`,
`ActivityEntry{icon,bg,fg,html,time}`.

## 4. States → cases
Modeled as a **composition fixture** (`"components"`) — each block is a row in
`isolate`, fed the real seed shapes from `lib/dash-seed.ts`.

| state | meaning | case |
|---|---|---|
| populated | all blocks filled from `SEED_*` (jobs, quotes, outstanding, activity, KPIs) | `cases/populated/populated.json` |
| empty | brand-new account — every block's honest-empty branch | `cases/empty/empty.json` |
| mobile | ≤640px: `.grid`→1-col, `.kpis`→2-up | `cases/mobile/mobile.json` |

(The dead `Hero` is documented but not given a live case — it has no importer.)

## 5. Events
- `ev.expect(e => e.source === "a.panel__action" && e.type === "click")` →
  nav (`#` for ActiveJobs header, `/quotes`, `/activity`).
- `ev.expect(e => e.source === "a.panel__action[href='/quotes']" && e.type === "click")`
  → ActiveJobs empty CTA → `/quotes`.
- `ev.expect(e => e.source === "button.qbtn--nudge" && e.type === "click")` →
  **NO-OP** (inert; flag). Same for `button.qbtn--view` and the Outstanding
  "Nudge all" button.
- No emitted custom events; no form submit. All real interactivity bubbles up to
  navigation links; the count-up is internal to `<Ticker/>`.

## 6. Motion (extracted — from dash-sections.css + dashboard.css)
- **`.kpi:hover`** → `translateY(-2px)` + shadow grow over **200ms**
  `cubic-bezier(.34,1.56,.64,1)` (bounce). Animates `transform` (cheap) +
  `box-shadow` (paint). **Jank finding:** the shadow change repaints the tile on
  hover; acceptable (hover, not scroll). Fix on low-end: layer a pseudo-element
  shadow and fade its opacity instead of animating `box-shadow`.
- **`.job__progress-bar`** — width set inline as a static `%`; no transition, so
  it does NOT animate in (paints at final width). (A rebuild could ease it from
  0 with `transition: width`.)
- **`.hero__pill-dot`** (used by ActiveJobs header dot, reused from `.hero`) →
  `ppulse` 2s infinite ring pulse (`@keyframes ppulse` in dash-sections.css).
- **Money count-up** — `<Ticker value={owed}/>` rAF eases 0→owed over 1400ms
  (see `ticker/` spec; **no reduced-motion guard** — a11y gap).
- **DEAD Hero** `.btn:hover` → `translateY(-1px)` + `brightness(1.05)` 180ms
  bounce; `.hero__title em` hosts the pink Ticker.
- **Reduced motion:** no section-local override — the **global tokens `@media
  (prefers-reduced-motion: reduce)`** clamps the kpi hover-lift transition and
  `ppulse` to `0.01ms`. The `<Ticker/>` count-up is JS-driven and is NOT clamped
  (flagged).

## 7. Responsive (this module's own @media — dash-sections.css)
- **Single breakpoint: `max-width: 640px`** (NOT the product default 720px —
  verify here).
  - `.grid` → `grid-template-columns: 1fr` (single column), gap 14px.
  - `.kpis` → `repeat(2, 1fr)` (2-up), gap 10px; `.kpi` padding tightens,
    `.kpi__val` → 22px, `.kpi__label`/`.kpi__delta-sub` allowed to wrap.
- `> 640px`: `.grid` is `1.45fr 1fr`; `.kpis` is `repeat(4,1fr)`.
- The `.panel` / `.money` cards themselves have no width media query — they fill
  their grid cell.

## 8. A11y
- **No headings hierarchy issue:** each panel uses `<h3 class="panel__title">`;
  the KPI labels are plain `<div>` (not headings) — fine.
- Section nav targets are real `<a>` (keyboard-operable). Icons are decorative
  SVG (no labels — acceptable, text follows).
- **GAP — inert buttons:** `.qbtn`/"Nudge all" are focusable `<button>`s with no
  action; a screen-reader/keyboard user can focus and "press" them to nothing.
  Either wire them or `disabled` + a "coming soon" affordance.
- **GAP — Activity dupe badge** is injected via `dangerouslySetInnerHTML`; it is
  trusted/escaped but the `· N×` count isn't announced as a separate unit.
- `Outstanding`'s money figure is animated text (`<Ticker/>`) with no
  `aria-live` and no reduced-motion guard — a number that visibly spins up for
  SR/low-vision users (flag; see ticker/ §8).
- Empty-state copy is real text (announced). Reduced motion handled globally.

## 9. Used on
**`/dashboard` only**, composed by the `DashboardPage` island
(`islands/DashboardPage.tsx` imports `Kpis/ActiveJobs/QuotesAwaiting/Outstanding/
Activity` from `components/DashSections.tsx`). The `Hero` export has **no
importer** (dead). `lib/dash-seed.ts` references the same row types for the
static fallback. Not shared with any other route.
