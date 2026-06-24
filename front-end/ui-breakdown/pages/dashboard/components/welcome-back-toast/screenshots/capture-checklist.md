# Capture checklist — WelcomeBackToast

**Theme:** light only.
**Auth:** log in with dev master OTP `000000`.
**Route:** `http://localhost:5280/dashboard?welcome=back` — the toast ONLY shows
when `?welcome=back` is present (it normally arrives via the `/verify` →
`/dashboard?welcome=back` returning-user redirect).

## Driving the toast (it self-strips the param + auto-dismisses)
- **To make it appear:** navigate to
  `http://localhost:5280/dashboard?welcome=back`. The island fetches `/api/me`,
  shows the pill, then after ~50ms `history.replaceState`s the URL to drop
  `welcome` and after 3000ms removes the pill.
- **Cache-bust the openurl** if testing on iOS Simulator (param is stripped, so a
  repeat openurl to the same URL must actually re-navigate).
- It will NOT re-show on refresh (param was stripped). Re-add `?welcome=back` to
  the URL each time you capture.
- **Timing:** capture within the 3s window. Drive it fast or temporarily widen
  the dismiss timer if you need a longer hold for a clean shot.

## Element(s) to crop
- The top-right pill: white, pill radius (999px), soft shadow, teal (#144852)
  text, a pink (#FF6B6B) 22px 👋 circle, message "Welcome back, {firstName}.".
  Crop the top-right corner of the viewport including some margin so the
  `top:18px right:18px` offset is visible.

## Viewports
- No own breakpoints (fixed top-right at all widths). Shoot:
  - **1280px** (desktop).
  - **390px** (mobile — VERIFY a long localized name doesn't overflow the right
    edge; there is no max-width).

## Transient states to drive
1. **named** — a seeded user with a name: "Welcome back, Raphael." (first token
   only).
2. **fallback-name** — a user with no name set: "Welcome back, friend."
   (`welcomeBackToast.nameFallback`).
3. **entrance** — film the `pm-toast-in` drop-in: opacity 0→1 +
   translateY(-6px) scale(.96) → settled, over 280ms bounce.
4. **auto-dismiss** — confirm the pill DISAPPEARS at ~3s. NOTE: there is NO exit
   animation — it pops out abruptly (capture the before/after to document the
   missing fade-out).
5. **no-param** — load plain `/dashboard` (no query): the pill never appears.
   Capture a clean dashboard to evidence the gate.
6. **param-stripped** — after the toast shows, confirm the address bar no longer
   has `?welcome=back` (replaceState fired) and a refresh shows no toast.

## Motion + reduced-motion
- Film the 280ms entrance, then re-shoot with
  **`prefers-reduced-motion: reduce`**: the island's own guard nulls
  `pm-toast-in`, so the pill appears instantly with no drop-in. Capture the
  static version.

## Notes
- `lang=es` ("Bienvenido de nuevo, {firstName}.") — capture both languages if
  exercising i18n; the template comes from `lib/lang.ts` STRINGS, not the JSON
  dict.
- NO fabricated screenshots — drive the real toast via the `?welcome=back` URL.
