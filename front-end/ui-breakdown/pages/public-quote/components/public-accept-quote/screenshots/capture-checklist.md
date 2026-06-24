# Capture checklist — PublicAcceptQuote

- **Route:** `/q/<quoteId>` (PUBLIC, auth-free, but needs a real quote id whose
  status is not yet accepted/lost). Rendered by `PublicQuoteActions`.
- **Surface:** the inline-styled **public palette** (design-tokens.md § Public
  surface), NOT Sabor.
- **Viewports:** 390 (mobile-first, primary), 640 (max card width). Single column.
- **Crop targets:** the accept/decline action area below the quote card; the
  accept confirmation step.
- **States to drive:**
  - `prompt` — accept + decline buttons visible.
  - `confirming` — accept confirmation flow open (name/typed-consent).
  - `accepted` — success state (the page re-renders the accepted badge).
  - `es` — Spanish (contractor `commsLanguage === "es"`).
- **Theme:** light only. **No fabricated screenshots** — needs a live backend + valid token.
