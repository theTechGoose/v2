# Capture checklist — page `/accounts-manager`

**Theme:** light only. **Auth:** any logged-in user; dev master OTP `000000` at
`http://localhost:5280`. **No fabricated screenshots.**

## Route / URL
- `http://localhost:5280/accounts-manager`.

## What to capture — HONEST-EMPTY
This page renders the app-shell with an **empty content area** (stub). The whole
point of the shots is to document the shell DELTAS, not content:
- **1280px** — DashSidebar mounted with **`showNav={false}`** (rail chrome but
  NO nav tabs — contrast against `/settings` or `/dashboard` which show tabs) +
  DashTopbar with **greeting only** (no date string) + a blank `.content`.
- **640px / 390px** — sidebar overlay, sticky topbar, empty content.

## Page-level notes
- There are **no local components and no content** to crop. Capture the shell
  state and the empty content region as evidence of the stub.
- If the sidebar with `showNav={false}` looks identical to a logged-out rail,
  note it: the difference vs other pages is the absence of nav tabs.

## Transient states
- None — nothing fetches, nothing animates in the content area.

## Motion
- None (content area is empty; only shared shell chrome).
