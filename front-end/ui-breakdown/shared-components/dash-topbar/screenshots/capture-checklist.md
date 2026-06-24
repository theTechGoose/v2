# Capture checklist — DashTopbar

**Theme:** light only.
**Auth:** dev master OTP `000000`. Topbar renders on every authed route.

## Route / URL
- `http://localhost:5280/dashboard` (default + empty).
- `http://localhost:5280/assistant` for the `greetingOverride` variant.
- Flip language in Settings (or `langSignal`) for the `es` variant.

## Viewports (own @media)
- **1280px** (full bar with ticker, right-aligned).
- **641px** (ticker still visible, just above mobile cutover).
- **390px** (sticky bar, ticker + search hidden — hamburger + greeting only).

## Element(s) to crop
- The `<header class="topbar">` strip (60px tall on desktop).
- Tight crop on `.topbar__ticker` to show the pulsing dot + rotating item + time.

## Transient states to drive
1. **default** — account with >=1 recent notification → ticker pill present.
   Wait ~4s between shots to catch the item rotating (`tickerIdx` advances every
   3.8s) and the `tickerSlideIn` entrance.
2. **empty** — fresh account / no notifications → NO ticker pill (only hamburger
   + greeting + empty space).
3. **override** — `/assistant` → greeting line replaced with the route's custom text.
4. **es** — Spanish weekday/month + greeting.

## Motion to film
- `tickerPulse` (1.6s halo on the dot) and `tickerSlideIn` (360ms bounce on item
  swap — capture the moment of rotation). Re-shoot with
  `prefers-reduced-motion: reduce` to confirm the global clamp stills them.
