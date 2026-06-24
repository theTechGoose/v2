# Capture checklist — ContractTrack

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/contracts` — the only host. Track 01 "In progress"
  defaults open; Tracks 02 "Starting soon" / 03 "Wrapping up" default collapsed;
  Track 04 "Drafts" appears collapsed **only when** there is ≥1 draft/stale
  contract.

## Viewports
Re-shoot at this component's own / host-page CSS breakpoints (contract-track.css
has no media query; the surrounding sections do):
- **1280px** (`--container-product`).
- **1100px** (contracts-sections.css KPI/hero reflow — header still single row).
- **700px** (contracts-sections.css single-column — confirm the header baseline
  row wraps cleanly: chevron + num + h2 title + right-aligned count).

## Element(s) to crop
- A single `<section class="ktrack">` — the header row (`.ktrack__chev` +
  `.ktrack__num` + `.ktrack__title` h2 + `.ktrack__count`) plus its body. Capture
  one expanded instance (Track 01, body full of `.kcards`) and one
  `ktrack--collapsed` instance (Track 02/03).

## Transient states to drive
1. **open** — Track 01 expanded with `ContractCard`s in the body.
2. **collapsed** — click `.ktrack__head` to collapse (chevron rotates from
   pointing down → right; body grid-rows clip to 0fr; margin-top → 0). **Reload**
   to confirm `localStorage["contracts:track:02"]` persisted the closed state.
3. **empty** — a track whose parent passed a `.kempty` slate as children (drive
   by an account with no contracts in that mood) → count reads "0 contracts" with
   the dashed empty slate inside.
4. **drafts** — Track 04 present (account with ≥1 draft/stale contract); confirm
   it is absent entirely on an account with no drafts.

## Motion to film
- Collapse/expand toggle: chevron `rotate(90deg↔0deg)` over **240ms
  var(--ease-bounce)** + body `grid-template-rows 1fr↔0fr` (+ `margin-top
  14px↔0`) over **320ms var(--ease-out)**. Film one full toggle. Re-shoot with
  `prefers-reduced-motion: reduce` — there is **no component-local guard**, so
  verify the global tokens clamp makes the collapse instant.

## NO fabricated screenshots
All frames must come from the live `/contracts` route. Do not synthesize the
track from isolate alone for the deliverable filmstrip; isolate is for state
coverage, the live route is the source of truth for motion + layout.
