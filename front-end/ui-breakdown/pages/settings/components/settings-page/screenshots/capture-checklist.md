# Capture checklist — SettingsPage

**Theme:** light only (single theme; no dark mode exists).
**Auth:** any logged-in contractor. Dev master OTP `000000` to log in at
`http://localhost:5280` (frontend :5280, backend :4280). No super-admin needed.
**No fabricated screenshots** — capture only against the running app.

## Route / URL
- `http://localhost:5280/settings`.

## Viewports (component has no own @media; uses dashboard's 640px cutover)
- **1280px** — `--container-product`; read-only pairs + Address/Insurance +
  Tax/ContractDefaults render two-up via `.grid`.
- **640px** — at/below this the `.hero` and every `.grid` collapse to ONE
  column (dashboard.css `@media (max-width: 640px)`); shoot just above and just
  below to capture the cutover.
- **390px** — phone; confirm the editable field grids reflow (auto-fit
  minmax(180px)) and the Danger Zone field clears the soft keyboard.

## Element(s) to crop
1. Hero (`.hero`, 1-col) — business-name title + sub.
2. Read-only summary `.grid` (Account + Business identity cards), incl. an
   honest-empty card ("Nothing set yet") if any sub-entity is blank.
3. Edit details card — fields + logo button + app-language select + comms
   toggle chips (show an `--on` green-bordered chip).
4. Address + Insurance grid (incl. a coverage-in-dollars value, cert "on file").
5. Tax + Contract-defaults grid (masked TIN "(on file: **-***…)", W-9 uploaded).
6. Payments card — at least one enabled (green-bordered) row with handle +
   retype-confirm fields.
7. Danger Zone card (red `.settings-danger`).

## Transient states to drive
1. **loading** — hard-reload `/settings`; capture the Skeleton (shimmer +
   page-header + 2-row card grid) before `/profile` resolves.
2. **error** — block/fail `GET /profile` (offline or stall) → the
   `.dashpage-error` message (NOTE: this class has no CSS rule — it renders as
   unstyled text; capture as-is and flag).
3. **saving / saved** — edit a field and blur; capture the "Saving…" then
   "Saved" (green) status in the card head before it clears.
4. **upload** — click Upload logo/cert/W-9; capture "Uploading…"; if possible
   drive a 413 to capture the "too large" error copy.
5. **payments-mismatch** — enable Venmo, type a handle, type a different
   confirm → red-bordered confirm input + "doesn't match" line.
6. **danger-armed** — type `DELETE` in the confirm field → wipe button turns
   solid red `#a83b3b` and enables. **Do NOT click** (irreversible wipe).

## Motion
- Only the load-state Skeleton shimmer (see shared-components/skeletons for the
  keyframes). Film it once; everything else is static. Reduced-motion: the
  global token CSS clamps it to 0.01ms.
