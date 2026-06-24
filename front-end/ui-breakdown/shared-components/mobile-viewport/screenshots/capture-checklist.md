# Capture checklist — MobileViewport

**Nothing to screenshot** — this island renders no DOM. It is verified by
observing the CSS custom properties on `<html>` and the focus-reveal scroll
behavior, not by pixels.

## How to verify (instead of cropping)
**Auth:** dev master OTP `000000`. Best on the **iOS Simulator** (idb, py3.9
venv; force the soft keyboard with cmd-K off so the on-screen keyboard shows).

1. **keyboard-open** — open a page with a text field near the bottom (e.g.
   `/settings`, or a public sign page `/c/<id>`). Focus the field; the keyboard
   slides up. In devtools/console, read:
   `getComputedStyle(document.documentElement).getPropertyValue('--app-vh')` →
   should equal `visualViewport.height`px; `--kb-inset` should be the full
   overlap; `--vvh`/`--vvt` should mirror the visual viewport. Confirm the field
   AND its trailing submit button stay above the keyboard.
2. **desktop** — same page on desktop: `--app-vh` absent (falls back to 100dvh),
   `--kb-inset` = `0px`.
3. **unmount** — navigate away; confirm all four properties are removed from `<html>`.

## Notes
- Cache-bust openurl when re-testing in the simulator.
- No motion to film; the value is smooth keyboard tracking via the dvh fallback
  (no JS-driven height snap).
