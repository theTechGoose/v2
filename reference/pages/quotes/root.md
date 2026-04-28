# Quotes Page — Root

> **Status:** Production-target page. **Medium backend dependency** — needs `GET /quotes` extended with per-quote engagement metrics (open count, open timestamps, device per open) plus a small `/analytics/quotes/*` rollup. The existing v2 `Quote` DTO has the price + line items but not the open-tracking or "stage" lifecycle the page renders. See `backend.md` §5 (Quotes module).

## Purpose

The contractor's pipeline view. Where `/clients` is a "people on the books" page, `/quotes` is a "what's in flight" page. Open quotes are split into **stages** along a single horizontal lifecycle:

```
draft → sent → opened → cooling → stale → won / lost
```

Each card visualises a single quote with the same editorial DNA as `<ClientCard>` — gradient mood band on top, big oversize numeral in the corner (rank within track, not days-since-contact), bleed-across avatar with client initials, narrative "story" line in the assistant's voice, action CTA. The mood gradient is **driven by the quote stage** (draft → coffee, sent → pink, opened → green, opened+hot → coral, cooling → muted coffee, stale → deep red).

The page surfaces engagement data the contractor can't see anywhere else: how many times the client opened the quote, on which devices, and when. Tapping a card flips it to reveal an **opens timeline** + a "reading" line that interprets the engagement pattern ("They're shopping — opened on multiple devices. Probably comparing. Time to send the offer.").

The right rail carries three smaller widgets: a **Top of the pipeline** leaderboard (biggest 4 open quotes by value), a **Win rate** half-donut showing won/lost over the last 90 days, and a **Monster tip** card (single statistical insight).

## Source

- **Prototype HTML:** `v2/reference/paperwork-monsters/project/Paperwork Monsters Quotes.html` (5577 lines)
- **Inline CSS:** Quotes.html lines **264–3499** (heavy — defines the entire `.app/.sidebar/.topbar/.stage` chrome shared with Dashboard/Clients/Assistant, plus the `.qph/.qkpi/.qcard*/.qtrack/.qcards/.qdone*/.qside*/.qbig/.qbar/.qrate/.qlay` selector set specific to this page)
  - Quotes-specific CSS sits at lines **1748–2380**
  - The block at **2381–onward** is **the Clients page CSS bundled in alongside** — both pages share the same prototype HTML build and reuse class sets. **Do not port the `.ccard2*` rules here**; they belong to the clients page.
- **Inline JSX (React 18 + Babel):** Quotes.html lines **3500–5575**
  - Shared chrome (Sidebar, Topbar, ICN, NAV, `<I>`, Spark, Ticker, ActivityTicker) at lines **4079–4307** is identical to Dashboard / Clients / Assistant — **reuse those component files; do not re-document**
  - The `JOBS`, `QUOTES`, `Hero`, `Kpis`, `ActiveJobs`, `QuotesAwaiting`, `Outstanding`, `Activity` data + components at **4309–4531** are the dashboard's, included in this prototype because the Phone preview reuses them (`QUOTES.slice(0,2)` at line 5462). They are **not** part of the production Quotes page.
  - The `CLIENTS`, `FILTERS`, `STATUS_LABELS`, `STORIES`, `HeroSpark`, `ClientsHero`, `LoopBar`, `ClientsToolbar`, `moodFor`, `ClientCard`, `ClientsCards`, `TopClients`, `TodayLoop`, `ClientsSegments`, `ClientsPage` block at **4533–4927** is the **Clients page bundled in** — also not part of this page. The clients code is ~400 lines of dead weight here; ignore it.
  - **Quotes-specific code starts at line 4929** (`QPIPELINE` data array). Everything from there to the `App` render at line 5503 is the actual Quotes page.

## Stack notes

The prototype is the same single-file React 18 + Babel setup as the other pages. Production is Fresh 2 routes + Preact islands. The wrapping `<div class="stage">` (browser-frame chrome) is prototype-only — do not port. `TweaksPanel`, `useTweaks`, `TWEAK_DEFAULTS` are dev tools — do not port.

The prototype bundles the Dashboard's KPI/Hero/panel components and the entire Clients page into the same HTML file (because the prototype tool exports each "screen" as a complete standalone page). **In production, treat them as separate routes.** The Quotes page only renders `<QuotesPage>` (Quotes.html:5324–5361); everything else compiled into the file is reachable cross-prototype navigation only.

## Route

```
v2/frontend/routes/quotes/index.tsx          → "/quotes"
v2/frontend/routes/quotes/[quoteId].tsx      → "/quotes/:quoteId"   (when card → full editor lands)
v2/frontend/routes/quotes/_middleware.ts     → requires auth (same as dashboard)
```

Card flip state ("front showing story" ↔ "back showing engagement timeline") is **per-card local state** for v1 — multiple cards can be flipped simultaneously, unlike the Clients page's single-open coordinator. The prototype does not enforce single-open across the grid; production should match (the timeline is small enough that comparing two side-by-side is a feature, not a bug).

## Layout (top-down)

```
.app
├── <Sidebar />                       ← reuse from dashboard (`pages/dashboard/components/sidebar.md`)
└── <main>
    ├── <Topbar />                    ← reuse from dashboard (`pages/dashboard/components/topbar.md`)
    └── .content
        └── <QuotesPage>              (no extra wrapper; just `<>…</>`)
            ├── <QuotesHero />         → components/quotes-hero.md       ✅ build
            ├── <QuotesKpis />         → components/quotes-kpis.md       ✅ build (4-tile strip)
            └── .qlay                  (grid: 1fr | 320px, stacks <1200px)
                ├── div                (left column — three Tracks)
                │   ├── <Track num="01" title="Out for response">  → components/track.md ✅ build
                │   │   └── <QuoteCard />[]   → components/quote-card.md ✅ build (sorted: opened > sent > cooling > stale)
                │   ├── <Track num="02" title="Drafting" defaultOpen={false}>
                │   │   └── <QuoteCard />[]
                │   └── <Track num="03" title="Decided this month" defaultOpen={false}>
                │       └── <DecidedRow />[]   → components/decided-row.md ✅ build (compact won/lost rows)
                └── <aside class="qside">  (sticky, top: 16px)
                    ├── <QSideBig />     → components/side-big.md     ✅ build (top-of-pipeline)
                    ├── <QSideRate />    → components/side-rate.md    ✅ build (win-rate half donut)
                    └── <QSideTip />     → components/side-tip.md     ✅ build (monster tip)

Side preview (desktop only):
└── <PhoneQuotes />                  → components/phone-preview-quotes.md   ✅ build (decorative)
                                      Same "decorative on desktop" rule as Dashboard's <Phone>.
                                      The Phone for the Quotes page renders the same mobile dashboard
                                      layout used by `/clients` — not a mobile quotes view.
```

## Page-level state

| State | Where | Note |
|---|---|---|
| `flipped` (per quote) | `<QuoteCard>` island, default `false` | Flips front ↔ back. Multiple cards can be flipped at once — there is no shared coordinator. |
| `open` (per Track) | `<Track>` island | Track 1 (`Out for response`) opens by default; tracks 2 and 3 collapsed. Persist per-user in `localStorage[`quotes:tracks:open`]` so contractors who always work on drafts get them open on next visit. |
| `sidebarCollapsed` | Reuse from Sidebar island | Same as Dashboard |

No filter or search on this page (unlike `/clients`). Stage IS the filter — quotes self-organise by where they sit in the lifecycle.

## Backend dependencies

**v1:**

| UI surface | Endpoint | Notes |
|---|---|---|
| Sidebar profile + counts | `GET /profile`, `GET /analytics/dashboard` | Same as Dashboard |
| Topbar bell + ticker | `GET /notifications` | Same as Dashboard |
| Quote pipeline (all tracks) | `GET /quotes` (existing v2) | Each quote needs derived `stage` + engagement rollup (see below) |
| Quote card flip → opens timeline | `GET /quotes/:id/opens` | **NEW** — returns `[{ at, device, ip? }]` per open event |
| `<QSideBig>` top-of-pipeline | derived client-side from the same `/quotes` payload | No extra call |
| `<QSideRate>` win rate | `GET /analytics/quotes/win-rate?days=90` | **NEW** — returns `{ won, lost, decided }` |
| `<QSideTip>` monster tip | `GET /analytics/quotes/insight` | **NEW** — returns one statistical observation; OK to ship a hard-coded fallback for v1 |

**Per-quote derived fields needed on `GET /quotes`:**

| Field | Derivation |
|---|---|
| `stage` | Lifecycle stage — `'draft' \| 'sent' \| 'opened' \| 'cooling' \| 'stale' \| 'won' \| 'lost'`. See "Stage definitions" below. |
| `daysIn` | Days since the quote entered its current stage |
| `opens` | Total open count (deduped to ~1/hour to avoid double-counting) |
| `sentDays` | Days since the quote was sent (null for drafts) |
| `decidedDays` | Days since won/lost (only for `won`/`lost` stages) |
| `band[0]`, `band[1]`, `shadow` | Pre-computed mood gradient + shadow CSS values (see `quote-card.md` §moodForQuote). Could also be computed client-side; either works. |

**Stage definitions** (precise rules — keep these consistent so contractors trust the lifecycle):

| Stage | Definition |
|---|---|
| `draft` | Quote has been created but `sentAt` is null |
| `sent` | `sentAt` ≥ now − 24h, `opens === 0` (the first 24 hours after send, even with no opens, is "just sent") |
| `opened` | `opens ≥ 1` AND `sentAt < now − 24h` (the client has touched it) |
| `cooling` | `sentAt < now − 4d`, `opens ≥ 1`, no opens in the last 48h |
| `stale` | `sentAt < now − 7d` AND no contract signed AND no decision recorded |
| `won` | The contractor manually marked it won, OR a contract was signed against it |
| `lost` | The contractor manually marked it lost, OR ≥ 30 days since `sentAt` with no signal |

The "opened+hot" sub-state (`opens ≥ 3` while `stage === 'opened'`) is purely visual — the gradient swaps from green to coral. The `stage` field stays `opened`; the hot bit is derived in `moodForQuote()` and the CTA text logic.

## Auth

**Required.** Same `_middleware.ts` as dashboard.

## Mobile breakpoints

The prototype defines a single hard breakpoint at **1200 px** (Quotes.html:2374):

```css
@media (max-width: 1200px) {
  .qlay { grid-template-columns: 1fr; }   /* sidebar drops below */
  .qside { position: static; }
  .qph { flex-direction: column; align-items: flex-start; }
  .qkpi { grid-template-columns: repeat(2, 1fr); }
}
```

A second breakpoint at **1100 px** collapses the decided-row two-column grid to one (`.qdone { grid-template-columns: 1fr; }`).

**Below 768 px** (production needs to extend the prototype):
- `.qcards` collapses from `repeat(auto-fill, minmax(320px, 1fr))` to a single column
- `.qkpi` drops to a single column (or 2×2 on slightly larger phones)
- `.qph__title`'s `clamp(28px, 4vw, 44px)` already handles font-size scaling
- The `<Phone />` preview is **not** rendered (desktop-only)

## Implementation order

1. **Page shell** — `/quotes` route, sidebar + topbar reuse, empty `<QuotesPage>` placeholder.
2. **`<QuotesHero />`** — pure presentation, derived counts. Static seed first, then wire to derived `GET /quotes` aggregates.
3. **`<QuotesKpis />`** — same: 4-tile strip, all derived from `GET /quotes`.
4. **`<Track />`** — collapsible group container with the chevron animation. Local `open` state.
5. **`<QuoteCard />` (front face only)** — mood band + numeral + status pill + opens chip + avatar + body + foot. Get the mood gradient logic right; the "story" CTA copy follows the rule table in `quote-card.md`.
6. **`<QuoteCard />` (back face)** — slide-up panel with the engagement timeline + reading line + 3 action buttons. Wire flip state.
7. **`<DecidedRow />`** — compact won/lost rows. Trivial.
8. **`<QSideBig />`** + **`<QSideRate />`** + **`<QSideTip />`** — right-rail widgets. The win-rate half-donut is the only piece with non-trivial SVG math.
9. **`<PhoneQuotes />`** — last; decorative.

## What NOT to port

- The `<div class="stage">` browser chrome (Quotes.html:5509).
- The `<div class="annot">` "Desktop · 1240 × 1040" / "Mobile · 380 × 760" labels (Quotes.html:5539–5552).
- `TweaksPanel`, `useTweaks`, `TWEAK_DEFAULTS` (dev tools).
- `window.LOGO_DATA_URL` — use `static/logo-monster.png`.
- The `.ccard2*`, `.ph2*`, `.loopbar*`, `.ctop2*`, `.csegment2*`, `.cseg2-row*`, `.cloop*` CSS blocks bundled in alongside the quote styles — those belong to `pages/clients/`.
- The `CLIENTS`, `STORIES`, `FILTERS`, `ClientsHero`, `LoopBar`, `ClientsToolbar`, `ClientCard`, `ClientsCards`, `TopClients`, `TodayLoop`, `ClientsSegments`, `ClientsPage` JSX bundled in alongside — those belong to the `/clients` route.
- The `JOBS`, `QUOTES`, `ACTIVITY`, `Hero`, `Kpis`, `ActiveJobs`, `QuotesAwaiting`, `Outstanding`, `Activity` JSX — those belong to `/dashboard`. Note: `QUOTES.slice(0, 2)` is referenced from the Phone preview's "Quotes waiting" section. In production, the mobile view fetches its own data.
- The `QSTORIES` editorial copy — these are mock narratives. Production must derive them from the agents module (preferred) or fall back to deterministic captions keyed to stage + engagement (see `quote-card.md` §Data source).
- The hard-coded `+8 pts vs Q1` delta in the win-rate KPI tile — that's a placeholder; either compute against last quarter or drop the delta line until the analytics rollup supports it.

## Conventions for this folder

Same as `pages/landing/`, `pages/dashboard/`, `pages/assistant/`, and `pages/clients/`. Each file's first paragraph clarifies whether it's `✅ build`, `⚠️ deferred`, or `decorative-only`. JSX is verbatim from the prototype; the Preact translation is in a separate sub-section per component file.

## Cross-reference (CSS selector → component)

For the underlying styles, the prototype's CSS (Quotes.html inline `<style>` lines 264–3499) defines:

| Selector family | Component |
|---|---|
| `.qph`, `.qph__eyebrow`, `.qph__eyebrow-dot`, `.qph__title`, `.qph__sub`, `.qph__cta` | quotes-hero |
| `.qkpi`, `.qkpi__cell`, `.qkpi__cell--accent`, `.qkpi__lbl`, `.qkpi__val`, `.qkpi__sub` | quotes-kpis |
| `.qtrack`, `.qtrack--collapsed`, `.qtrack__head`, `.qtrack__chev`, `.qtrack__num`, `.qtrack__title`, `.qtrack__count`, `.qtrack__body`, `.qtrack__body-inner` | track |
| `.qcards`, `.qcard`, `.qcard--flipped`, `.qcard__mood`, `.qcard__numeral`, `.qcard__status`, `.qcard__status-dot`, `.qcard__opens`, `.qcard__opens-dots`, `.qcard__opens-dot`, `.qcard__opens-dot--on`, `.qcard__av`, `.qcard__body`, `.qcard__client-name`, `.qcard__title`, `.qcard__story`, `.qcard__foot`, `.qcard__cta`, `.qcard__val-wrap`, `.qcard__val-lbl`, `.qcard__val-num`, `.qcard__back*`, `.qcard__timeline*`, `.qcard__topen*`, `.qcard__read`, `.qcard__flip-hint` | quote-card |
| `.qdone`, `.qdone__row`, `.qdone__badge`, `.qdone__badge--{won,lost}`, `.qdone__title`, `.qdone__client`, `.qdone__amt`, `.qdone__amt--lost`, `.qdone__when` | decided-row |
| `.qside` (root sticky wrapper, defined in root.md) | (root) |
| `.qside__card`, `.qside__head`, `.qside__title`, `.qside__sub`, `.qbig`, `.qbig__row`, `.qbig__rank`, `.qbig__name`, `.qbig__sub`, `.qbig__amt`, `.qbar`, `.qbar__fill` | side-big |
| `.qrate`, `.qrate__svg`, `.qrate__num`, `.qrate__num-pct`, `.qrate__lbl` | side-rate |
| (no extra selectors — uses `.qside__card` only with inline styles) | side-tip |
| `.qlay` | (root layout) |
| `.phone__*`, `.phero*`, `.pkpi*`, `.pjob*`, `.psection-*`, `.ptab*`, `.home-indicator` | phone-preview-quotes (shared with dashboard's phone-preview where identical) |

## Shared primitives needed (in addition to dashboard's)

| Primitive | Where defined | Reused by |
|---|---|---|
| `<I d={...} size={...} sw={...}/>` icon component | Quotes.html:4082–4086 (identical to dashboard) | every visual element with an icon |
| `ICN.{plus,chev,check,x,bell,signal,wifi,battery,home,invoice,user,send,crown}` | Quotes.html:4088–4127 (subset of dashboard's) | this page + dashboard + clients + assistant |
| `Sidebar`, `Topbar` | Quotes.html:4139–4307 (identical to dashboard) | reuse `pages/dashboard/components/{sidebar,topbar}.md` |
| `fmtMoney(n)` helper | Quotes.html:4987 — `(n) => n.toLocaleString()` | used by every dollar amount on the page; promote to a `frontend/lib/format.ts` helper |
| `moodForQuote(q)` helper | Quotes.html:5049–5061 | quote-card |
| `buildOpens(q)`, `readingFor(q, opens)` helpers | Quotes.html:5073–5108 | quote-card — these are **mock-data fallbacks** that production replaces with real API data; documented inside `quote-card.md` |

## Bug to flag in the prototype

`OpenDots` (Quotes.html:5063–5069) renders `<span class="qcard__opens-dot">` markers but **the prototype defines no CSS for `.qcard__opens-dot` or `.qcard__opens-dots`** — they render as zero-size empty spans. The visible "1×" / "3×" text in the opens chip is entirely the trailing count; the dots are invisible in the prototype. Production should either:

- Add the missing styles (suggested: 5px circles, white at 30% / 80% alpha for off/on)
- Drop the dots entirely and keep only the count

The decision is style; flagging it because anyone scanning the JSX will assume the dots render and won't notice they don't.
