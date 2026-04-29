# Live activity ticker (`.topbar__ticker__*`)

## What
A pill-shaped button that rotates through recent product activity events ("Tom & Linda opened your quote", "Cobblestone Cafe paid $1,000"). Sits in the topbar, between the menu button and greeting on dashboard pages that use it.

## Behavior
- Driven by a parent `setInterval(3800ms)` that increments an index over a `TICKER_EVENTS` array (4 entries in the static export).
- Each newly rendered `.topbar__ticker-item` plays `tickerSlideIn` (360ms ease-bounce) on mount; the prior item is replaced (no exit animation, the `key={i}` swap remounts).
- `.topbar__ticker-dot` continuously plays `tickerPulse` (1.6s ease-in-out infinite) — green outward ripple.
- Hover: white background + 35% border + translateY(-1px) lift.

## Anatomy
- `.topbar__ticker` — outer pill (green-50 surface).
- `.topbar__ticker-dot` — 8px green circle, pulsing.
- `.topbar__ticker-track` — fixed-height, overflow-hidden viewport for the rotating items.
- `.topbar__ticker-item` — absolutely positioned text row; `strong` callouts the actor (e.g. client name).
- `.topbar__ticker-time` — monospace "2m ago" timestamp on the trailing edge.

## Source
`pages/dashboard/raw.html` lines 605–670 (CSS), 2342–2369 (component logic + markup).

## Animations
See `animations.md` and `shared/design-tokens/motion.md`.
