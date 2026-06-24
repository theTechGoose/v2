# Capture checklist — Skeletons

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## How to drive (these are the cold-load first paint)
The page islands fetch on mount, so the skeleton shows for the brief moment
before data arrives. To capture reliably, throttle the network (DevTools → Slow
3G) or pause the relevant `clients/*.ts` fetch, then hard-navigate to the route.

## Routes / URLs (which variant shows where)
- **card-grid** → `http://localhost:5280/dashboard` (also /quotes, /clients,
  /contracts, /settings).
- **list** → `http://localhost:5280/payments` (also /invoices).
- **page-header** + **skel-block** are sub-parts visible within the above; or
  render them directly in isolate.

## Viewports (borrowed from `.grid`/`.panel`)
- **1280px** (two-column grid).
- **640px** (grid collapses to one column).

## Element(s) to crop
- The full skeleton region inside `.content` (header + grid/list).

## Transient states to drive
1. **card-grid** — throttled load of /dashboard before data lands.
2. **list** — throttled load of /payments.
3. **page-header** / **skel-block** — via isolate variant control.

## Motion to film
- `pmShimmer` left-to-right sheen (1.4s loop). Film one full cycle. Re-shoot with
  `prefers-reduced-motion: reduce` to confirm the global clamp stills it (this
  component ships no local reduced-motion guard).
