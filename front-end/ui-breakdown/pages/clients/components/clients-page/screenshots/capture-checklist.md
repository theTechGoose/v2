# Capture checklist — ClientsPage

- **Route:** `/clients` (auth-gated — dev master OTP `000000`).
- **Viewports** (clients.css real `@media`): 390, 768, 980, 1280. Shell drawer
  cutover at 640/641.
- **Crop targets:** the `.content` island; the ClientsSections analytics rails
  (top clients, segments); the ClientsBoard rows; the Add-client modal overlay.
- **States to drive:**
  - `loading` — skeletons (initial `Promise.all`).
  - `ready` — populated from `lib/clients-seed.ts` (12 customers; derived
    status/segment/lastTone via `lib/clients-display.ts`).
  - `empty` — no customers.
  - `error` — only if the outer `.then` throws (each fetch is `.catch`-guarded).
  - `add-modal` — open the inline Add-client modal (note: not `role=dialog`, no
    focus trap, Esc doesn't close — capture for the a11y rebuild).
- **Theme:** light only. **No fabricated screenshots** — capture against a seeded dev backend.
