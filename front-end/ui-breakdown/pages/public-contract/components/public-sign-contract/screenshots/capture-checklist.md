# Capture checklist — PublicSignContract

- **Route:** `/c/<contractId>` (PUBLIC, auth-free, needs a real unsigned contract).
- **Surface:** inline-styled **public palette**.
- **Viewports:** 390 (mobile-first — primary touch target), 640.
- **Crop targets:** the signature canvas, the typed-name field, the submit button,
  the post-sign success panel.
- **States to drive:**
  - `empty` — blank canvas, submit disabled (`hasInk` false).
  - `ink` — pointer-drawn signature present.
  - `typed-name` — name typed.
  - `submitting` — spinner.
  - `signed` — 900 ms success panel before the hard reload (flagged anti-pattern).
- **Motion/jank:** capture is secondary to the documented jank lint —
  `onPointerMove` calls `getBoundingClientRect()` twice/sample + full stroke
  redraw per sample (no rAF). **A11y:** ink is pointer-only; keyboard/SR users
  are blocked from signing — note in any review still.
- **Theme:** light only. **No fabricated screenshots** — needs a live backend + valid token.
