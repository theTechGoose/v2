# Capture checklist — MoneyInput

- **Where:** rendered inside `AsstChat`'s price-capture screen — live route
  `/assistant/<threadId>` (auth: dev master OTP `000000`) when Bossie asks for a
  price; or in isolate at `/components/assistant/money-input/<case>`.
- **Viewports:** 390 (mobile, primary), 768, 1280.
- **Crop targets:** the money field + the preset chips (`CHIP_PRESETS_CENTS`) +
  the keypad/submit.
- **States to drive:**
  - `empty` — no value, autofocus.
  - `value` — a typed amount.
  - `chip-active` — a preset chip selected (e.g. $1,000).
  - `large` — 8-digit amount triggering the auto-shrink type scale.
  - `es` — Spanish (drive via `_signals.lang` — the `lang` prop is an ignored
    SSR seed; the island reads `langSignal`).
- **Theme:** light only. Money is **integer cents**. **No fabricated screenshots.**
