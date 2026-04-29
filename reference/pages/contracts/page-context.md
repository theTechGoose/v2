# Contracts

## Purpose
The contractor's job-pipeline view. Shows everything that's been signed and is now in some stage of execution: in progress, starting soon, or wrapping up. Drives the day's milestone awareness via a 30-day schedule strip and a card-flip detail view per contract.

## Top-level structure
Standard `.stage` → `.window` → `.app` → `.main` chrome. `<ContractsPage>` composes:

1. **`<ContractsHero>`** — `.kph__*` editorial hero with eyebrow, big amount, and "Schedule a job" CTA.
2. **`<ContractsKPIs>`** — `.kkpi` 4-cell breakdown: In progress · Starting soon · Wrapping up · Closed in April.
3. **`<ScheduleStrip>`** — `.csched__*` 30-day schedule with greedy lane-packed bars per contract (a "today" indicator overlays).
4. **`<ContractsTrack num="01" title="In progress">`** — collapsible track of `.kcard` flip cards.
5. **`<ContractsTrack num="02" title="Starting soon">`** — same.
6. **`<ContractsTrack num="03" title="Wrapping up">`** — same.

## Layout chrome (uses `shared/`)
- `shared/sidebar`, `shared/topbar`, `shared/annotation-dots`, `shared/phone-preview`.
- The page has its own hero (`.kph`), so `shared/hero-banner` isn't used.

## Page-unique components
- [schedule-week-view](components/schedule-week-view/) — `.csched__*` 30-day schedule strip with lane-packed bars.
- [contract-card](components/contract-card/) — `.kcard__*` flip card (mood band, avatar, progress, milestone back).
- [contract-track](components/contract-track/) — `.ktrack__*` collapsible section that hosts `.kcard` rows.
- [loop-bar](components/loop-bar/) — `.loopbar__*` strip (same component as on the Clients page).
- [contract-kpi](components/contract-kpi/) — `.kkpi__*` 4-cell breakdown.

## Notable interactions
- Contract cards `flip` on click. Outer onClick sets `flipped=true`; inner buttons / back panel call `e.stopPropagation()` so they don't re-flip.
- Tracks collapse/expand with `useState(defaultOpen=true)` driving `.ktrack--collapsed`. Body uses height transition.
- The schedule strip computes lane packing client-side: each contract greedily takes the lowest-index lane that's free for its full span. `--lanes-h` is set as a CSS var per row to size the lane column.

## Source
`extracted/Paperwork Monsters Contracts.html` (also at `pages/contracts/raw.html`).
