# AssistantCoachmark

A one-shot, full-screen onboarding **overlay** shown on a user's FIRST dashboard
visit after onboarding. It darkens the whole app, cuts a spotlight hole over the
sidebar's "My Assistant" button (`.sb__textus`), and floats a pink speech bubble
pointing at it — so the only lit affordance is the assistant CTA. Click anywhere
to dismiss; it persists "shown" to `localStorage` and never returns.

## 1. Classification & behavior
- **Bucket:** `island` (file lives in `islands/AssistantCoachmark.tsx`). Mounted
  at the **root** of the dashboard route (sibling of `.app`, not inside it) so it
  can overlay everything at `z-index: 9999`.
- **Interaction tier:** `island` — client-only state, self-gating, no server
  contact, no data fetch. Pure presentational overlay driven by viewport
  measurement + timers.
- **Self-gate (the headline behavior):** on mount it reads
  `localStorage["pm:assistant-coachmark-shown"]`; if `=== "1"` it returns early
  and renders nothing. So SSR is unaffected (the island emits nothing on the
  server / on repeat visits). First visit only.
- **Client state owned (`useState`):**
  - `visible: boolean` — gates the whole overlay (false until the target button
    is found + measured).
  - `box: {top,left,width,height} | null` — the measured
    `getBoundingClientRect()` of the `.sb__textus` button (the hole geometry).
  - `fadingOut: boolean` — drives the 320ms exit fade before unmount.
  - `phase: 0 | 1 | 2` — entrance choreography stage (pre-mount → entering →
    settled); gates which animations run.
- **Target acquisition (fragile coupling — FLAG):** it `document.querySelector`s
  `'a[href="/assistant"].sb__textus, .sb__textus[href="/assistant"]'` and
  **retries every 120ms up to 30 times** (~3.6s) waiting for the DashSidebar
  island to hydrate and paint the button. This is a **cross-island DOM
  dependency** — if the sidebar markup/selector changes or the sidebar fails to
  hydrate, the coachmark silently never shows (it just exhausts its retries). Fix:
  have the sidebar expose the button position via a shared signal or a known
  ref/anchor rather than string-querying its internal class.
- **Data source:** none — no `clients/*`, no cache. Geometry comes from the live
  DOM; copy from `tFor(lang, "assistantCoachmark.*")`.
- **Reactive language:** reads `langSignal.value` at render; the optional `lang`
  prop is an ignored SSR seed.
- **Liveness:** request-response-free. Timers only: the rAF-deferred phase kick,
  a `setTimeout(800ms)` to mark `phase=2`, the `setTimeout(320ms)` exit, plus a
  `resize` listener that re-measures the hole. No polling beyond the 30×120ms
  acquisition retry.
- **Dismiss / persistence:** any click on the overlay → `dismiss()`:
  `setFadingOut(true)`, write `localStorage["pm:assistant-coachmark-shown"]="1"`
  (try/catch SSR-safe), then `setVisible(false)` after 320ms. **The flag is
  written on dismiss, NOT on first show** — so a user who reloads before clicking
  will see it again (acceptable: it's a one-interaction gate, not a one-render
  gate).
- **`location.reload()`:** none. ✅ Dismiss is in-place unmount, no nav.
- **Data-shape hazards:** `box` is `null` until measured → early `return null`
  guard before any geometry math. All `localStorage` access is try/catch-wrapped
  (SSR / privacy-mode safe). The SVG mask geometry is computed from `box` +
  fixed paddings — no external data to malform.

## 2. Anatomy
```
(localStorage shown==="1") → never renders
(!visible || !box) → null
else:
<div role="dialog" aria-label="Onboarding hint — click anywhere to dismiss"
     onClick=dismiss
     style="position:fixed;inset:0;z-index:9999;cursor:pointer;
            transition opacity+backdrop-filter 320ms; opacity 0|1; blur 0|2px">
  <svg width=100% height=100% aria-hidden style="position:absolute;inset:0;pointer-events:none">
    <defs>
      <mask id=coachmark-mask>  ← white full-rect minus a black rounded-rect over the button (evenodd cut-out)
      <radialGradient id=coachmark-glow>  ← pink → transparent
    <rect fill="rgba(15,28,33,0.74)" mask=url(#coachmark-mask)>   ← dark backdrop with the hole
    <ellipse fill=url(#coachmark-glow)>                           ← ambient pink bloom under button
    (phase>=1) <circle×2 animation:coach-ripple>                 ← two staggered sonar ripples
    <rect stroke=PINK animation:coach-breathe(phase2)>           ← spotlight ring (scale .6→1 then breathe)
    (phase===2) <circle×4 animation:coach-orbit>                 ← orbital sparkles
  <div style="… pink gradient bubble, slides in from right">     ← speech bubble
    <div> 👋(coach-wave) + heading "Click here to talk to your assistant"
    <div> body "Bossie drafts quotes, sends contracts, chases invoices. Tap to start."
    <div> ← arrow notch (coach-arrow-nudge, phase2) pointing left at the button
  <div style="bottom hint"> "click anywhere to dismiss"
  <style> @keyframes coach-ripple|breathe|orbit|wave|arrow-nudge + reduced-motion guard
```
- **Slots/children:** none.
- **Dependency:** the live DOM position of DashSidebar's `.sb__textus` button (see
  the FLAG above). No `ICN`/icon import; the 👋 is an emoji, the arrow is a CSS
  triangle, the ring/ripples are SVG.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `lang` | `"en"\|"es"` | `undefined` (IGNORED) | — | superseded by `langSignal` |

The island is mounted bare (`<AssistantCoachmark />`). `lang` is a vestigial SSR
seed; the live value is `langSignal.value`.

## 4. States → cases
The whole thing is internal timer/measurement state; isolate models it via
`_signals` (visible/box/phase/fadingOut) + `_mocks` for the localStorage gate +
the target button geometry. Because it positions itself off a real
`.sb__textus`, isolate needs a stub anchor at a known rect (provide a `box`).

| state | meaning | case |
|---|---|---|
| settled | first visit, fully landed (phase 2): backdrop + spotlight + bubble + sparkles | `cases/settled/settled.json` |
| entering | mid-entrance (phase 1): ring springing in, ripples emitting, bubble sliding | `cases/entering/entering.json` |
| already-shown | `localStorage` flag set → renders nothing | `cases/already-shown/already-shown.json` |
| fading-out | post-click exit (phase 2 + fadingOut): backdrop/blur fading to 0 | `cases/fading-out/fading-out.json` |

## 5. Events
- `ev.expect(e => e.source === "div[role='dialog']" && e.type === "click")` →
  `dismiss()`: writes `localStorage["pm:assistant-coachmark-shown"]="1"`, fades
  out over 320ms, unmounts. (The entire overlay is the click target — click
  anywhere.)
- External (received): `window` `resize` → re-`measure()` the button → updates
  `box` so the hole tracks the button if layout shifts.
- No emitted custom events; no nav; no fetch.

## 6. Motion (extracted — self-injected <style> + inline transitions)
Total intro ~700–800ms before the bubble lands; timeline:
- **t=0** backdrop fades in (wrapper `opacity` + `backdrop-filter: blur(2px)`,
  320ms ease-out).
- **t=120ms** spotlight ring springs `scale(0.6)→1` (`transform 520ms
  cubic-bezier(.34,1.56,.64,1)`, overshoot) + opacity in.
- **t=240ms** ambient glow ellipse fades in (480ms ease-out, +240ms delay); two
  **sonar ripples** emit (`coach-ripple` 1.6s ease-out, delays 0.24s/0.48s, 2
  iterations).
- **t=320ms** speech bubble slides
  `translateX(-24px) scale(.85) rotate(2deg) → 0/1/0` (460ms bounce, +320ms
  delay).
- **t=520ms** dismiss hint fades + rises in.
- **after settle (phase 2):** spotlight ring **breathes**
  (`coach-breathe` 2.6s ease-in-out infinite, +800ms delay), 4 **orbital
  sparkles** (`coach-orbit` 5.2s linear infinite, staggered i×1.3s), the 👋
  **waves** (`coach-wave` 2.8s), the arrow **nudges** (`coach-arrow-nudge` 1.6s).
- **Keyframes (in css/assistant-coachmark.css + the island's inline <style>):**
  `coach-ripple, coach-breathe, coach-orbit, coach-wave, coach-arrow-nudge`.
- **Jank findings:**
  - The dark backdrop is an SVG `<rect mask=url(#coachmark-mask)>`; SVG masking +
    `backdrop-filter: blur(2px)` on a full-viewport `position:fixed` layer is
    paint-heavy and can stutter on first frame on low-end devices. The blur in
    particular forces an offscreen composite of everything behind it. Acceptable
    for a one-shot overlay, but prefer a CSS box-shadow "hole" (a large inset
    shadow on a transparent div positioned over the button) over SVG masking if
    smoothness matters.
  - `coach-breathe` animates `filter: drop-shadow(...)` which repaints each frame
    — fine at 2.6s, but it's the most expensive of the loops.
- **Reduced motion:** the island ships its OWN scoped guard
  (`@media (prefers-reduced-motion: reduce)` → `[role=dialog] * { animation:none
  !important; transition-duration: 80ms !important }`), in ADDITION to the global
  tokens clamp. Good — every child animation is killed and transitions snap.

## 7. Responsive (own @media)
- **No width breakpoints.** It self-positions off the measured `.sb__textus`
  rect and re-measures on `resize`, so it tracks the sidebar at any width.
- **Caveat:** on mobile (≤640px) the sidebar is an off-canvas drawer — the
  `.sb__textus` button may be translated off-screen / not laid out, so `box`
  could measure a hidden/zero-area rect or the query may resolve to an element at
  `translateX(-100%)`. The coachmark does not special-case mobile; verify the
  hole lands sensibly (or that the overlay is suppressed) at ≤640px during
  capture. Likely intended for desktop first-run.

## 8. A11y
- `role="dialog"` with an `aria-label`. The decorative SVG layer is
  `aria-hidden`.
- **GAPS (modal hygiene):**
  - No **focus trap** and focus is not moved into the dialog on open.
  - No **`Esc` to close** (only click-anywhere) — a keyboard-only user with no
    pointer can't dismiss it, and Tab can escape behind the overlay.
  - The bubble copy is in a plain `<div>`, not wired as the dialog's
    `aria-labelledby`/`aria-describedby` (the `aria-label` carries a generic
    string instead of the heading/body).
  - It's a click-to-dismiss `role=dialog` with `cursor:pointer` everywhere — fine
    visually, but no keyboard-operable dismiss affordance.
- Reduced motion is well handled (own guard + global).

## 9. Used on
**`/dashboard` only.** Imported by `routes/dashboard/index.tsx`
(`import AssistantCoachmark from "../../islands/AssistantCoachmark.tsx"`),
rendered once at the route root (outside `.app`). Not shared. Depends on
DashSidebar (shared) for its anchor button — but is itself dashboard-only.
