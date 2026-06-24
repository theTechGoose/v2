# Capture checklist — AssistantCoachmark

**Theme:** light only.
**Auth:** log in with dev master OTP `000000`.
**Route:** `http://localhost:5280/dashboard`. The overlay is mounted at the route
root and only appears on a user's FIRST visit (self-gates on
`localStorage["pm:assistant-coachmark-shown"]`).

## Driving the one-shot (it hides itself after one interaction)
- **To make it appear:** clear the flag, then reload —
  `localStorage.removeItem("pm:assistant-coachmark-shown")` in the console (or use
  a fresh/incognito session), then navigate to `/dashboard`. Wait for the
  DashSidebar island to hydrate so the `.sb__textus` button exists (the coachmark
  retries up to ~3.6s to find it).
- **It will NOT reappear** once you click it (the flag is written on dismiss).
  Clear the flag again between captures.

## Element(s) to crop
- The full-viewport overlay: the dark masked backdrop with the spotlight HOLE cut
  over the sidebar "My Assistant" button, the pink ring + ripples, the speech
  bubble to the right of the button, and the bottom "click anywhere to dismiss"
  hint. Capture the whole viewport (it's a full-screen overlay).

## Viewports
- No own breakpoints; it tracks the measured button rect. Shoot:
  - **1280px** (primary — desktop first-run, sidebar expanded, hole over the
    expanded `.sb__textus`).
  - **641px** (sidebar still a fixed rail — confirm the hole still lands).
  - **390px** (sidebar is an off-canvas drawer — VERIFY where/whether the hole
    lands; the button may be translated off-canvas. Document the actual behavior;
    do not assume it shows.)

## Transient states to drive (MOTION component — film the choreography)
1. **entrance (filmstrip)** — film the staged intro on fresh appearance:
   - t≈0: backdrop fades + blurs in.
   - t≈120ms: spotlight ring springs scale .6→1 (overshoot).
   - t≈240ms: ambient glow + two sonar ripples emit.
   - t≈320ms: speech bubble slides in from the right (scale + slight rotate).
   - t≈520ms: dismiss hint fades up.
2. **settled (phase 2)** — the looping idle: ring breathing (2.6s), 4 orbital
   sparkles (5.2s, staggered), 👋 waving (2.8s), arrow nudging (1.6s). Capture a
   still + a short loop.
3. **dismiss / fade-out** — click anywhere; film the 320ms backdrop opacity +
   blur fade to 0, then unmount. Confirm `localStorage` flag becomes "1".
4. **already-shown** — reload WITHOUT clearing the flag: overlay does not appear
   (clean dashboard). Capture to evidence the one-shot gate.

## Motion to film + reduced-motion
- Film items 1–2 above, then re-shoot with **`prefers-reduced-motion: reduce`**:
  the island's OWN scoped guard kills all child animations and snaps transitions
  to 80ms — capture the static, no-loop version (backdrop + ring + bubble appear
  near-instantly, nothing breathing/orbiting/waving).

## Notes
- This overlays the REAL DashSidebar — the spotlight hole geometry depends on the
  live `.sb__textus` rect. Capture against the actual sidebar, not a stub.
- NO fabricated screenshots — drive the real overlay via the localStorage flag.
