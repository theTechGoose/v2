# Capture checklist — LoginForm

**Theme:** light only.
**Route/URL:** `http://localhost:5280/login`. Auth-free → **capture-ready**
(if a session cookie exists the route 302s to `/dashboard`; capture logged-out).

## Auth
None to reach the page. To exercise the success path end-to-end use dev master
OTP `000000` on the resulting `/verify` page.

## Viewports (component has no own @media; it fills the .verify-card, max 440px)
- **Desktop 1280px** — card centered.
- **Mobile 390px** — card near full width; verify-shell re-centers above the
  iOS soft keyboard (`--vvh`/`--vvt`). Capture with keyboard up if possible.

## Element(s) to crop
- The whole `.verify-card` (brand + "Welcome back" h1 + subtitle + form).
- The form alone (label + input + submit + helper).

## Transient states to drive
1. **default** — empty, caret in the input (autofocus).
2. **filled** — type `5125550142` → input shows `(512) 555-0142`.
3. **submitting** — submit a valid number; the button shows `…` briefly before
   navigation (throttle network or stub the API to hold this frame).
4. **error** — submit an incomplete number (e.g. `512555`) → red
   "Phone number is incomplete" `<p role=alert>`.
5. **es** — set `localStorage["pm:lang"]="es"` (or arrive via the landing toggle
   which sets the `pm_lang` cookie) → Spanish labels.

## Motion to film
- None — LoginForm has no CSS animation/transition. (Only the label text swaps
  to `…`.) No reduced-motion variant needed.
