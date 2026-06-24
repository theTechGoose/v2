# Capture checklist — CodeInput

**Theme:** light only.
**Route/URL:** `http://localhost:5280/verify?phone=%2B15125550142` — the route
**302s to `/` if `?phone=` is missing**, so always include it. Auth-free →
**capture-ready** (302s to `/dashboard` if already logged in).

## Auth
None to reach the page. Dev **master OTP `000000`** always verifies — use it to
drive the success → step-indicator-fill → redirect sequence.

## Viewports (component has no own @media)
- **Desktop 1280px** — card centered; the six 44×56 boxes sit comfortably.
- **Mobile 390px** — verify-shell re-centers the card above the soft keyboard
  (`--vvh`/`--vvt`); the OTP keypad should auto-open (`inputMode=numeric`).
- **320px edge** — verify the slot row doesn't overflow the card padding.

## Element(s) to crop
- The whole `.verify-card` (brand + `.pm-steps` + h1 + lede + CodeInput).
- The `.code-input` row alone (empty, filled, focused-slot, shake frame).
- The `.pm-steps` indicator at step 2 (active "Code") and the post-success
  "You're in" state (all three done/active).

## Transient states to drive
1. **default** — empty, slot 1 focused.
2. **filled** — type `482913` (boxes fill, auto-advances, CTA enables).
3. **submitting** — submit `000000`; CTA shows the busy label briefly.
4. **success** — after `000000`, watch `.pm-steps` flip step 2→done and step 3→
   active "✓" (400ms before the redirect to `/dashboard?welcome=back`). Stub or
   throttle to hold this frame.
5. **error** — type any wrong 6 digits → `.error` message + `.shake` (380ms),
   digits clear, slot 1 refocuses. Capture each error string (invalid/expired/
   rate) if drivable.
6. **resend-cooldown** — tap "Resend code" → button disables, counts "Resend in
   30s" → 0.
7. **es** — `localStorage["pm:lang"]="es"` (or arrive with `&lang=es`) → Spanish.

## Motion to film
- `shake` (360ms) on a wrong code.
- Input focus glow transition (140ms).
- `.pm-steps__dot` 280ms recolor + `pm-steps-pulse` halo on the success step.
- Reduced motion: re-run; shake + pulse should be neutralized (clamp + the
  explicit `prefers-reduced-motion` rule on the active dot).
