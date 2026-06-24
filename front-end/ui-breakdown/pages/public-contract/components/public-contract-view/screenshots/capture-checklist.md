# Capture checklist — PublicContractView

- **Route:** `/c/<contractId>` (PUBLIC, auth-free, needs a real contract id).
- **Surface:** inline-styled **public palette**; embeds the shared `contract-doc`.
- **Viewports:** 390 (mobile-first), 640. Single column.
- **Crop targets:** the rendered contract document (`contract-doc`); the sign
  call-to-action that launches `PublicSignContract`.
- **States to drive:**
  - `unsigned` — contract shown with a "sign" action.
  - `signed` — post-signature state (signature block filled, action gone).
  - `expired/error` — invalid/expired link.
  - `es` — Spanish (terms stored in English, localized at render).
- **Theme:** light only. **No fabricated screenshots** — needs a live backend + valid token.
