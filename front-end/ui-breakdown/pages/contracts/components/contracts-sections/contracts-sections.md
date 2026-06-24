# ContractsSections

The three server-rendered presentational sections at the top of `/contracts`,
exported from one module (`components/ContractsSections.tsx`):
**`ContractsHero`** (`.kph`), **`ContractsKpis`** (`.kkpi`, 4 cards), and
**`ScheduleStrip`** (`.csched`, a dark-teal Gantt-style 30-day lane chart). The
empty-track slate (`.kempty`) CSS also lives in this folder (it is contracts-page
chrome rendered by `ContractsPage`, not its own component).

## 1. Classification & behavior
- **Bucket:** `page-composition` (static section blocks). These are plain
  functional components rendered **inside** the `ContractsPage` island's output —
  they are not islands themselves (no `useState`/`useEffect`, no hydration of
  their own) and have no client interactivity beyond CSS `:hover`.
- **Per-interaction tier:**
  - `ContractsHero` CTA: a static **`<a href="/assistant?seed=…">`** — a real
    anchor, full navigation. No form, no PRG, no island. Correct pattern.
  - `ContractsKpis`: pure display, no interaction.
  - `ScheduleStrip` bars: CSS `:hover` scale/brightness + a native `title`
    tooltip; no click handler, no island.
- **Server action + flash:** none — read-only presentation.
- **Island client-state owned + refresh:** **none.** All three are stateless
  functions of their props. They never re-fetch; the parent island
  (`ContractsPage`) owns the single client-side fetch and re-renders these with
  fresh props.
- **`location.reload()` flag:** none in this module. (The hero CTA is a proper
  `<a>`, not a JS navigation — contrast `ContractCard`'s button-as-link
  anti-pattern.)
- **Data source per region:**
  - `ContractsHero`: all values are **props** (`totalValue`, `contractCount`,
    `inFlightCount`, `inFlightValue`, `startingSoonCount`, `pendingDeposits`) —
    INTEGER CENTS for money, run through `fmtMoney`. Computed by `ContractsPage`
    from the `toContractCard` projection, NOT fetched here.
  - `ContractsKpis`: 8 numeric/cents props, same origin.
  - `ScheduleStrip`: a `cards: ContractCard[]` prop (the *live* cards =
    active+starting-soon+wrapping-up) — it lays them out by
    `scheduleStart`/`scheduleEnd` day coordinates. No fetch.
  - None of these call `clients/contracts.ts` or `ssrBackendGet` — they are
    downstream of the parent island's fetch.
- **Honest-empty:**
  - Hero: `allZero` (no in-flight, no deposits, no starting-soon) → renders the
    `contractsHero.empty` sub-line and **hides** the active-value line.
  - ScheduleStrip: when `placed.length === 0` (no bars in the 1..30 day window) →
    `.csched__empty` slate ("nothing scheduled" copy). The grid + week labels
    still render.
  - `.kempty` slate (this folder's CSS, rendered by the parent): the dashed
    empty-state box a `ContractTrack` shows when its mood bucket is empty.
- **Liveness:** none. The pulsing eyebrow dot (`q-pulse-dot`, 2.4s) and the
  "TODAY" marker are **cosmetic** — the TODAY line is a fixed coordinate
  (`TODAY_INDEX = 8`), not a real-time tick.
- **Reactivity / i18n:** `lang` is a prop (default `"en"`); every label uses
  `tFor`/`tnFor(lang, …)`. Re-localizes only when the parent passes a new `lang`.
- **Data-shape hazards:**
  - **ScheduleStrip lane-packing (`packLanes`) is O(cards × lanes)** and runs on
    every render over the *whole* live-card list with **no pagination** — fine at
    demo scale, but it's the client-side face of the data-model hazard "Contract
    list `mood` … full-list read with no pagination" (data-model §5.9). If a
    contractor has hundreds of live contracts the strip packs them all into
    overlapping lanes every render.
  - **Schedule coordinates are a fixed 30-day window** (`RANGE_FROM=1`,
    `RANGE_TO=30`, day 8 = today, anchored `now − 7 days`). Contracts outside
    −7..+22 days are filtered out of the strip entirely (`c.scheduleEnd >= 1 &&
    c.scheduleStart <= 30`) — a card can exist in a track but be invisible on the
    strip. By design, but worth noting.
  - **Money is INTEGER CENTS** into `fmtMoney`. The parent already converts the
    card's dollar strings back to cents before passing here (the "$10 vs $1,000"
    100×-low bug guard, see `ContractsPage` §1) — these components must receive
    cents, not dollars.
  - **Hero `subMid`/`depositsAmount`** interpolate `{n}`/`{money}` — the plural
    of `startingSoonCount` is handled by the i18n key, not re-pluralized here.

## 2. Anatomy
```
ContractsHero — <section class="kph"><div class="kph__inner">
  <div>
    <div class="kph__eyebrow"><span dot/> {eyebrow} · {N contracts}</div>
    <h1 class="kph__title"><em>{fmtMoney(totalValue)}</em> {titlePre}<br/>{titlePost}</h1>
    <p class="kph__sub">{allZero ? empty : (jobsRunning · <strong>{deposits}</strong> {subMid})}</p>
    {!allZero && <p class="kph__sub" style="…opacity:.75">{activeValue}</p>}
  </div>
  <a class="kph__cta" href="/assistant?seed=…"><I plus/> {cta}</a>
</section>

ContractsKpis — <div class="kkpi"> (4 cards)
  <div class="kkpi__card kkpi__card--accent">  In progress  → .kkpi__num--pink {N jobs} / {active money}
  <div class="kkpi__card">                      Starting soon → {N jobs} / next-14-days money
  <div class="kkpi__card">                      Wrapping up   → {N jobs} / left-to-bill money
  <div class="kkpi__card">                      Closed (mo.)  → {N jobs} / all-paid money

ScheduleStrip — <section class="csched">
  <div class="csched__head"> eyebrow + title + <div class="csched__legend"> (in-progress / scheduled swatches)
  <div class="csched__grid">
    WEEKS.map → <div class="csched__weekrow"><div weeklbl/><div class="csched__weekbar" style="--lanes-h">
        {showToday && <div class="csched__today" style="left:…"/>}    ← pink line + "TODAY" ::before
        {bars.map → <div class="csched__bar [--scheduled]" style="--bar-from/--bar-to;left;width;top;height" title="client — when">
           {initials} · {firstName}</div>}
    {placed.length===0 && <div class="csched__empty">{empty}</div>}

.kempty — dashed empty slate (rendered by ContractsPage into a ContractTrack body)
```
- **Layout math (ScheduleStrip):** `packLanes()` greedily assigns each card to the
  first lane whose end < the card's start (else a new lane); `pos()`/`widthPct()`
  map day coords to `%` within a week's `from..to`; `--lanes-h` sizes the row.
- **Icon dependency:** `I` + `ICN.plus` (hero CTA) from `lib/dash-icons.tsx`
  (copied to `js/dash-icons.tsx`).

## 3. Props
Three exported components; one row per prop. (Page-composition, so the isolate
fixture uses a `"components"` map keyed by each export — see fixture.json.)

**ContractsHero**
| name | type | default | control | signal? |
|---|---|---|---|---|
| `totalValue` | number (CENTS) | — | number | no |
| `contractCount` | number | — | number | no |
| `inFlightCount` | number | — | number | no |
| `inFlightValue` | number (CENTS) | — | number | no |
| `startingSoonCount` | number | — | number | no |
| `pendingDeposits` | number (CENTS) | — | number | no |
| `lang` | `"en"\|"es"` | `"en"` | select | no |

**ContractsKpis**
| name | type | default | control | signal? |
|---|---|---|---|---|
| `inProgressCount` | number | — | number | no |
| `inProgressValue` | number (CENTS) | — | number | no |
| `startingSoonCount` | number | — | number | no |
| `startingSoonValue` | number (CENTS) | — | number | no |
| `wrappingUpCount` | number | — | number | no |
| `wrappingUpLeft` | number (CENTS) | — | number | no |
| `closedCount` | number | — | number | no |
| `closedValue` | number (CENTS) | — | number | no |
| `lang` | `"en"\|"es"` | `"en"` | select | no |

**ScheduleStrip**
| name | type | default | control | signal? |
|---|---|---|---|---|
| `cards` | `ContractCard[]` | — | (array — built by `toContractCard`) | no |
| `lang` | `"en"\|"es"` | `"en"` | select | no |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| populated | hero + 4 KPIs + schedule strip with packed bars (typical board) | `cases/populated/populated.json` |
| empty | hero `allZero` empty line + KPIs all 0 + `.csched__empty` slate | `cases/empty/empty.json` |
| es | Spanish labels across all three sections | `cases/es/es.json` |
| schedule-overlap | ScheduleStrip alone with overlapping bars → 2+ lanes packed + TODAY marker | `cases/schedule-overlap/schedule-overlap.json` |
| kempty-slate | the `.kempty` dashed slate in isolation | `cases/kempty-slate/kempty-slate.json` |

## 5. Events
Effectively none (no JS handlers). Capture the only navigations / hover affordances:
- `ev.expect(e => e.source === "a.kph__cta" && e.type === "click")` → native link
  navigation to `/assistant?seed=…` (no preventDefault; full nav).
- `ev.expect(e => e.source === "div.csched__bar" && e.type === "mouseenter")` →
  CSS-only `scaleY(1.1)` + `brightness(1.1)` (no JS); native `title` tooltip
  surfaces `"{client} — {when}"`.

## 6. Motion (extracted from contracts-sections.css)
- **Eyebrow dot:** `.kph__eyebrow-dot` + the schedule has no dot, but the hero dot
  pulses via `q-pulse-dot` (opacity 1→.4→1) `2.4s infinite` — the single keyframe
  in this file (contracts.css has 1 keyframe total, shared with quotes.css).
- **Hero CTA hover:** `.kph__cta:hover { transform: translateY(-2px) }` over
  `transform 240ms var(--ease-bounce)`.
- **Schedule bar hover:** `.csched__bar:hover { transform: scaleY(1.1);
  filter: brightness(1.1) }` over `transform 240ms var(--ease-out), filter 240ms`.
- **TODAY marker:** static pink 2px line with a `::before` "TODAY" chip + glow
  shadow — **no animation** (fixed coordinate).
- **Scheduled-bar pattern:** `.csched__bar--scheduled` is a static diagonal
  `repeating-linear-gradient` hatch over the mood gradient (the "not started yet"
  affordance) — no motion.
- **Jank finding:** `scaleY(1.1)` on a `position:absolute` bar is GPU-cheap and
  smooth; no layout thrash (bars are absolutely positioned, so the scale doesn't
  reflow siblings). No identified jank.
- **Reduced motion:** **no component-local block** in contracts-sections.css —
  relies on the global tokens reduced-motion clamp. Verify the eyebrow pulse stills
  and the hover transforms snap under `prefers-reduced-motion: reduce`.

## 7. Responsive (this module's own @media — from contracts-sections.css)
- **`@media (max-width: 1100px)`:** `.kkpi` → `repeat(2, 1fr)` (4 cards become a
  2×2 grid); `.kph__inner` → single column (`1fr`, `align-items:start`); `.kph__cta`
  `justify-self:start` (CTA drops below the hero text, left-aligned).
- **`@media (max-width: 700px)`:** `.kkpi` → `1fr` (KPI cards stack 1-up).
- The hero title is fluid: `font-size: clamp(34px, 4.5vw, 56px)`.
- ScheduleStrip has **no own media query** — the `60px 1fr` week-row grid + `%`
  bar positioning fluidly squeeze; verify bar labels (`initials · firstName`)
  truncate (`text-overflow:ellipsis`) rather than overflow at narrow widths.

## 8. A11y
- **Hero CTA** is a real `<a>` with text + icon — good (focusable, link role).
- **ScheduleStrip bars** convey info via color + a `title` tooltip + truncated
  inline text. **Gaps:** the lane chart has no table/list semantics, no text
  alternative for the visual timeline, and `title` is not reliably exposed to
  screen readers / not keyboard-reachable. The legend swatches are decorative
  `<span>`s with adjacent text (acceptable). **Rebuild:** give the strip an
  accessible name + per-bar `aria-label` ("{client}, {status}, {when}"), or a
  visually-hidden list fallback.
- **KPI cards** are plain `<div>`s — the label/number/sub are readable text
  (acceptable); consider `<dl>`/`<dt>`/`<dd>` semantics in rebuild.
- **Color-only legend:** in-progress vs scheduled is distinguished by a solid vs
  dashed swatch — there is text beside each, so it is not color-only. Good.

## 9. Used on
**Only** `islands/ContractsPage.tsx` (`/contracts`), imported as
`{ ContractsHero, ContractsKpis, ScheduleStrip }`. Evidence: grep of the import.
The `.kempty` slate styled here is rendered by `ContractsPage` directly into empty
`ContractTrack` bodies. CSS: `static/contracts.css` (`.kph*`, `.kkpi*`, `.csched*`,
`.kempty` — extracted to `css/contracts-sections.css`).
