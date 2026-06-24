# Capture checklist — ContractsSections (Hero / KPIs / ScheduleStrip)

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/contracts` — the only host. These three sections render
  at the top of the page body (above the tracks), in order: Hero → KPIs →
  ScheduleStrip. They appear immediately after the island finishes its fetch
  (before that, the page shows skeletons — see contracts-page/).

## Viewports
Shoot at this module's own `@media` breakpoints (from contracts-sections.css):
- **1280px** (`--container-product`) — KPIs 4-across; hero text left, CTA right.
- **1100px** (the module's first breakpoint) — KPIs become **2×2**; hero
  collapses to a single column with the CTA dropping below, left-aligned. Capture
  the exact reflow at this width.
- **700px** (the module's second breakpoint) — KPIs stack **1-up**.
- Also ~360px to confirm hero title `clamp(34px,4.5vw,56px)` floors and schedule
  bar labels truncate.

## Element(s) to crop
- `<section class="kph">` — eyebrow (pulsing dot + "Work in flight · N
  contracts"), `<em>$total</em>` headline, deposits sub-line, the `.kph__cta`
  anchor. Also crop the **empty** variant (allZero sub-line, no active-value line).
- `<div class="kkpi">` — all 4 cards; the first (`--accent`) has the pink number.
- `<section class="csched">` — the dark-teal panel: head + legend, 5 week rows,
  packed bars, the pink "TODAY" line + chip. Also crop the `.csched__empty` slate.
- `<div class="kempty">` — the dashed empty-track slate (rendered by the parent
  into an empty track; or capture via isolate `kempty-slate` case).

## Transient states to drive
1. **populated** — account with live + scheduled + closed contracts → full hero
   numbers, all KPIs non-zero, schedule bars packed across lanes.
2. **empty** — fresh account (no contracts) → hero `allZero` line, KPIs all "0
   jobs", `.csched__empty` slate inside the strip.
3. **es** — Settings → Spanish → all labels re-localize (eyebrow, title pre/post,
   KPI labels, schedule eyebrow/title/legend/week labels).
4. **schedule-overlap** — many overlapping live contracts → 2+ lanes packed,
   `--lanes-h` grows the week rows; the TODAY marker sits in the day-8 week.
5. **bar hover** — pointer over a `.csched__bar` → `scaleY(1.1)` + brightness;
   native `title` tooltip shows "{client} — {when}".

## Motion to film
- **Eyebrow pulse:** `.kph__eyebrow-dot` `q-pulse-dot` 2.4s (cosmetic).
- **Hero CTA hover:** `translateY(-2px)` 240ms bounce.
- **Schedule bar hover:** `scaleY(1.1)` + `brightness(1.1)` 240ms.
- The "TODAY" marker and scheduled-bar diagonal hatch are static (no motion).
- Re-shoot hover + pulse with `prefers-reduced-motion: reduce` — **no
  component-local guard**; verify the global tokens clamp stills/snaps them.

## NO fabricated screenshots
All frames from the live `/contracts` route (drive empty via a fresh account;
drive overlap via a seeded multi-contract account). Isolate cases exist for
state-completeness; do not pass off an isolate render as the live deliverable.
