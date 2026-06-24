# Capture checklist — Ticker

**Theme:** light only.
**Auth:** log in with dev master OTP `000000` (any seeded phone).
**Route:** `http://localhost:5280/dashboard`. Ticker has no route of its own — it
is a text node rendered inside the **Outstanding** money card
(`.money__amt`). Capture it there.

> Reminder: this is the rAF number count-up, NOT the topbar's rotating headline
> marquee (`.topbar__ticker`, a `DashTopbar` mechanism). Do not shoot the topbar
> line for this component.

## Element(s) to crop
- The `.money__amt` figure in the Outstanding card (`$` + the animated number).
  Crop tight to the numerals so the count-up is the subject.

## Viewports
- The component has no media queries; it inherits from `.money__amt`. Shoot at
  **1280px** (desktop) and **390px** (mobile, where Outstanding has restacked at
  640px) to confirm it reflows with the host.

## Transient states to drive (this is a MOTION component — film, don't just shot)
1. **count-up (cold)** — load `/dashboard` with a cold cache so Outstanding
   mounts fresh and the number eases **0 → owed over ~1400ms**
   (ease-out-cubic). Film the full filmstrip: capture frames at ~0ms, ~200ms,
   ~600ms, ~1000ms, ~1400ms to show the deceleration.
2. **settled** — the final frame, e.g. `6,420` fully landed.
3. **re-animate on data change** — if a refresh changes `owed`, the number spins
   **from 0 again** (not a delta-tween). Capture this restart to document the
   flagged behavior (loud re-spin on minor value changes).
4. **zero** — an account with `owed=0`: renders "0" with no visible motion.
5. **reduced-motion (NEGATIVE check)** — set
   `prefers-reduced-motion: reduce` and reload. **EXPECT the count-up to STILL
   RUN** (no guard) — capture this to evidence the a11y gap; do NOT assume it
   stops.

## Isolate filmstrip
- In isolate, the `prefixed` case (`prefix:"$"`, `value:18420`) is the cleanest
  count-up subject. The mid-flight value is not a settable prop, so film the
  animation rather than expecting an intermediate case.

## Notes
- No CSS keyframes exist for this component — all motion is JS rAF. There is
  nothing to capture in a CSS animation inspector; record the rendered text over
  time instead.
- NO fabricated screenshots — film the live `/dashboard` Outstanding card.
