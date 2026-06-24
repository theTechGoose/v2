# Capture checklist — ImpersonationBanner

**Theme:** light only (banner is off-palette maroon regardless).
**Auth:** must be a **super-admin** session. Dev master OTP `000000` for login,
then from `/admin` use the impersonate control on a target user.

## Route / URL
- Start at `http://localhost:5280/admin`, impersonate a user → the banner pins to
  the top of EVERY page while impersonating. Capture on `/dashboard`.

## Viewports (no own @media)
- **1280px** (single line: "Impersonating <name> (as <you>)" + button).
- **390px** (label + button wrap to two lines via `flex-wrap`).

## Element(s) to crop
- The fixed bar at `top:0` (`role="status"`, maroon `#7a2e2e`). Include enough of
  the page below to show it overlays content.

## Transient states to drive
1. **hidden** — ordinary (non-impersonation) session: confirm NO bar renders
   (whoami → `impersonating:false`).
2. **impersonating** — active impersonation: idle bar with "Return to your
   account" button.
3. **busy** — click "Return to your account"; capture the disabled button
   reading "Returning…" before the redirect to `/admin` fires (drive by stalling
   the `/admin/stop-impersonating` response, or screenshot quickly).

## Motion
- None to film (no transitions/animations).
