# ClientsSections

Four pure-presentation sections for `/clients`, exported from one module
(`components/ClientsSections.tsx`): `ClientsHero` (editorial page header + Add
CTA), `LoopBar` (dark "Today's loop" ribbon), `TopClients` (right-rail
leaderboard), `ClientsSegments` (right-rail segment-mix bars). They render
backend data passed in as props — no fetch, no state.

## 1. Classification & behavior
- **Bucket:** `page-composition` — these live in `components/` (not `islands/`),
  are imported by the `ClientsPage` island, and are server-renderable pure
  functions. The module header says so: *"Pure presentation — feed them backend
  data."*
- **Interaction tier:** `static` for three of them (no state/events). The one
  exception is **`ClientsHero`'s `onAdd` callback** — it is a closure created
  *inside* the `ClientsPage` island and passed down, so it hydrates with that
  island (not a cross-island prop). The button itself is plain markup; the
  behavior (open the add-client modal) belongs to the parent island.
- **Server action / flash / PRG:** none. No forms here (the add-client form is
  the parent island's inline modal).
- **Data source per region + honest-empty:**
  - `ClientsHero` — derived counts (`totalClients`, `activeJobs`, `owedTotal`,
    `quietCount`) computed in the parent island from `CustomerCard[]`. **Honest
    empty:** `totalClients === 0` swaps to a distinct "Let's add your *first
    client*" headline + sub.
  - `LoopBar` — `picks: CustomerCard[]` (top 3 lead/owes by days-since-contact,
    chosen by the parent's `pickLoop`). **Honest empty:** `picks.length === 0`
    renders a "No check-ins drafted yet" ribbon with an "Open the assistant" CTA.
  - `TopClients` — `rows: TopClient[]` from `/analytics/clients/top`. **Honest
    empty:** `rows.length === 0` → "No paid invoices in the last year yet."
  - `ClientsSegments` — `rows: ClientSegmentRow[]` from
    `/analytics/clients/segments`. **Honest empty:** `rows.length === 0` → "No
    clients yet."
- **Liveness:** none (no polling/websocket). Props are a frozen snapshot from
  the parent's on-mount fetch.
- **Anti-patterns:** none. No `location.reload`, no fetch, no frozen-SSR-prop
  trap (these are children of the island, re-rendered when the parent's state
  updates).
- **Data-shape hazards:**
  - `TopClient.revenue12moCents` and `ClientSegmentRow` are **separate
    whole-account aggregates** from the per-customer `/clients` rollup — two
    extra analytics scans per page load (data-model.md hazard #3). `barPct` /
    `pct` arrive precomputed (no client math beyond `width:${pct}%`).
  - `ClientsHero.owedTotal` is passed as **dollars** (the parent divides
    `balanceCents / 100` before passing) — note the unit break from the
    cents-everywhere convention; `TopClients` instead receives raw cents and
    formats via `dollars()`. Keep the boundary straight on rebuild.
  - `numberWord(totalClients)` only has words 0–20 (`clients-display.ts`); above
    20 it falls back to digits — the editorial "*twelve* people" headline
    degrades gracefully.
  - `LoopBar` avatar gradients cycle a fixed 3-entry palette (`LOOP_AV_BG`) — by
    design `picks` is capped at 3.

## 2. Anatomy
```
ClientsHero → <div class="ph2">
  <div>
    <div class="ph2__crumb"><dot/> Clients · {n} on the books</div>
    {empty
      ? <h1 class="ph2__title">Let's add your <em>first client</em>.<br>They'll keep…</h1>
        <p class="ph2__sub">Once a quote ships…</p>
      : <h1 class="ph2__title">The <em>{word} people</em><br>who keep the lights on.</h1>
        <p class="ph2__sub"><strong>{n} jobs in flight</strong> · <strong>${owed}</strong> currently owed … · <strong>{n} quiet</strong> clients worth a hello.</p>}
  </div>
  <button class="ph2__cta" onClick={onAdd}><I plus/> Add a client</button>

LoopBar → <div class="loopbar">
  <div class="loopbar__title"><span class="loopbar__lbl"><dot/> Today's loop</span>
    <span class="loopbar__h">{n} friendly check-ins…  | empty heading}</span></div>
  [<div class="loopbar__avs">{picks.map → .loopbar__av {initials}} <div class="loopbar__av-meta">{names}<br><strong>~{n*30} seconds</strong> to send …</div></div>]
  <a class="loopbar__cta" href="/assistant"><I send/> Open the loop | Open the assistant</a>

TopClients → <div class="ctop2">
  <div class="ctop2__head"><div class="ctop2__title">Top of the leaderboard</div><div class="ctop2__period">last 12 mo</div></div>
  {empty ? <div class="ctop2__empty">…</div>
         : <div class="ctop2__list">{rows.map → <div class="ctop2__item"><div class="ctop2__rank [--1]">{rank}</div><div class="ctop2__name"/><div class="ctop2__amt">{dollars}</div></div><div class="ctop2__bar-wrap"><div class="ctop2__bar" style=width:{barPct}%/></div>}</div>}

ClientsSegments → <div class="csegment2">
  <div class="csegment2__title">Who's on your books</div>
  {empty ? <div class="csegment2__empty">No clients yet.</div>
         : rows.map → <div class="cseg2-row"><div class="cseg2-row__lbl">{plural label}</div><div class="cseg2-row__bar"><div class="cseg2-row__fill" style=width:{pct}%;background:{SEGMENT_COLOR[key]}/></div><div class="cseg2-row__num">{count}</div></div>}
```
- **Icon dependency:** `I` + `ICN.{plus,send}` from `lib/dash-icons.tsx`
  (copied to `js/dash-icons.tsx`).
- **Helper dependency:** `dollars`, `initialsOf`, `numberWord` from
  `lib/clients-display.ts` (copied to `js/clients-display.ts`).
- **`SEGMENT_COLOR` map** (in-file): `property_mgmt`→green, `homeowner`→pink,
  `small_biz`→teal, `hoa`→coffee-500, `unsorted`→coffee-300.

## 3. Props
**ClientsHero**
| name | type | default | widget | signal? |
|---|---|---|---|---|
| `totalClients` | number | — | number | no |
| `activeJobs` | number | — | number | no |
| `owedTotal` | number (DOLLARS) | — | number | no |
| `quietCount` | number | — | number | no |
| `lang` | `"en"\|"es"` | `"en"` | select | no |
| `onAdd` | `() => void` | `undefined` | (Events — island closure) | no |

**LoopBar** — `picks: CustomerCard[]`, `lang`.
**TopClients** — `rows: TopClient[]`, `lang`.
**ClientsSegments** — `rows: ClientSegmentRow[]`, `lang`.

## 4. States → cases
| state | meaning | case |
|---|---|---|
| hero-populated | non-empty editorial headline + stat sub | `cases/hero-populated/hero-populated.json` |
| hero-empty | `totalClients=0` → "first client" headline | `cases/hero-empty/hero-empty.json` |
| loopbar-picks | 3 drafted check-ins with avatars | `cases/loopbar-picks/loopbar-picks.json` |
| loopbar-empty | no check-ins → "Open the assistant" | `cases/loopbar-empty/loopbar-empty.json` |
| topclients-rows | 5 leaderboard rows (rank 1 gold) | `cases/topclients-rows/topclients-rows.json` |
| segments-rows | 4 segment bars | `cases/segments-rows/segments-rows.json` |
| es | Spanish UI language | `cases/es/es.json` |

Because this is a **page-composition** module (multiple exports), the fixture's
`controls` target one component at a time via `_name`; cases name which export
they exercise. The fixture lists all four under `components`.

## 5. Events
- `ClientsHero`: `capture(page)`: `e.source === "button.ph2__cta" && e.type === "click"`
  → calls `onAdd` (parent island opens the add-client modal). Callback prop —
  not serializable; documented here, not in the isolate fixture.
- `LoopBar` / `TopClients` / `ClientsSegments`: no JS events; the loop CTAs are
  plain `<a href="/assistant">` navigations.

## 6. Motion (extracted from clients.css)
- `.ph2__crumb-dot` and `.loopbar__lbl-dot`: `ph2-pulse 2.4s infinite` (animated
  expanding box-shadow ring — real keyframe).
- `.ph2__cta:hover`: `translateY(-2px)` + deeper shadow (`--dur-fast`, bounce).
- `.loopbar__cta:hover`: `translateY(-1px)` (`--dur-fast`).
- `.cseg2-row__fill`: `transition: width 1s var(--ease-bounce)` — the segment
  bars animate their width when `pct` changes (bouncy 1s fill). **Jank note:**
  animating `width` triggers layout, but on a thin 6px bar with few rows it's
  negligible; could swap to `transform: scaleX()` for compositor-only animation.
- **Reduced motion:** no component-local block; relies on the global tokens
  clamp. Verify pulse + the 1s segment fill go instant.

## 7. Responsive (own @media in clients.css)
- **`max-width:1100px`:** `.ph2` stacks (`flex-direction:column;
  align-items:flex-start`); `.loopbar` → single column (`grid-template-columns:
  1fr`); `.cside2` loses `position:sticky`.
- **`max-width:768px`:** `.ph2__title` 44px → 28px; `.ph2__cta` full-width
  centered.
- `.ctop2` / `.csegment2` have no own breakpoints (they reflow with the rail
  column collapsing under the cards at 1100px).

## 8. A11y
- Emits a single `<h1>` (`.ph2__title`) — correct page-level heading; the rail
  section titles are plain `<div>`s, not headings (consider `<h2>` for
  "leaderboard" / "Who's on your books").
- The Add CTA is a real `<button type="button">` — good.
- Loop/avatar visuals are decorative; initials are text (readable).
- Bars (`ctop2__bar`, `cseg2-row__fill`) are purely visual with the numeric
  value shown alongside — acceptable; no `role="progressbar"`/`aria-valuenow`.

## 9. Used on
- `/clients` only. Imported by `islands/ClientsPage.tsx`
  (`ClientsHero`, `LoopBar` rendered directly; `TopClients` + `ClientsSegments`
  passed as `ClientsBoard` children for the right rail). Evidence: sole importer
  of `components/ClientsSections.tsx`. CSS in `static/clients.css`.
