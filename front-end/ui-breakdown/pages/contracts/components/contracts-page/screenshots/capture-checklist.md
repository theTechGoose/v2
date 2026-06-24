# Capture checklist — ContractsPage

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/contracts` — this island IS the page body. The route
  ships the shell (`DashSidebar` + `DashTopbar` + `.content`) + skeleton; the
  island fetches `/contracts` + `/clients` + `/quotes` on mount and renders
  Hero → KPIs → ScheduleStrip → Tracks 01–04.

## Viewports
ContractsPage has no own `@media`; the stack is a single column and all
responsiveness comes from the children. Shoot the whole page at:
- **1280px** (`--container-product`).
- **1100px** (KPIs reflow to 2×2, hero stacks — contracts-sections breakpoint).
- **700px** (KPIs 1-up, full mobile stack).

## Element(s) to crop / capture
- **Whole page body** (below the topbar) at each viewport — the full
  hero→KPI→schedule→tracks stack.
- **Loading state** — the skeleton: `PageHeaderSkeleton` + `CardGridSkeleton
  rows={3}` (shared Skeletons). Capture before the fetch resolves.
- **Error state** — `<div class="kpage-error">` (drive a fetch failure). Document
  that it renders as **unstyled text** (the `.kpage-error` class has no real rule
  in contracts.css/dashboard.css — flagged hazard).
- **Empty state** — fresh account: hero allZero line, 4 zero-KPIs, `.csched__empty`
  strip, Tracks 01–03 each with a `.kempty` slate, **Track 04 absent**.

## Transient states to drive
1. **loading** — hard-reload `/contracts` and capture the skeleton frame before
   the three GETs resolve (throttle network to hold it if needed).
2. **populated** — seeded account spanning all moods → Tracks 01 (open) + 02/03/04
   (collapsed by default). Expand each track to show its cards.
3. **empty** — fresh account → empty slates + no Track 04.
4. **error** — block/500 the `/contracts` request → `.kpage-error` text.
5. **es** — Settings → Spanish → whole page re-localizes without a re-fetch.
6. **track expand** — click each `.ktrack__head` to expand 02/03/04 (the
   transient track-expand state called out in the brief).
7. **card mood states** — within the tracks, the 6 card moods + a flipped card
   (the transient card mood/flip states called out in the brief).

## Motion to film
- The island itself has **no motion**; film the loading→ready swap (hard pop, no
  crossfade) and defer all real motion to the child filmstrips (skeleton shimmer,
  hero pulse/CTA, schedule hover, track collapse, card flip/hover/prog-fill).
- Re-shoot loading + a track collapse + a card flip with `prefers-reduced-motion:
  reduce` to verify the global tokens clamp (no component-local guards anywhere
  in this page's tree).

## NO fabricated screenshots
Every frame from the live `/contracts` route (drive loading via network throttle,
empty via a fresh account, error via a blocked request, populated via a seeded
account). Isolate cases pin the five states deterministically for state-coverage;
they are not a substitute for the live page deliverable.
