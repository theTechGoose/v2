# Capture checklist — AdminPage

**Theme:** light only.
**Auth:** **SUPER-ADMIN session REQUIRED.** Dev master OTP `000000` logs in at
`http://localhost:5280`, but the account must carry the `superAdmin` flag or
`routes/admin/_middleware.ts` 302-redirects to `/dashboard` and you never reach
this page. (Grant the flag on the dev account first, or log in as a known
super-admin.) **No fabricated screenshots** — capture only against the running
app.

## Route / URL
- `http://localhost:5280/admin`.

## Viewports (component has no own @media; uses shell's 640px cutover)
- **1280px** — full table, all five columns; `wrap` max-width 980px centered.
- **980px** — content max-width; confirm table fits.
- **640px / 390px** — sidebar becomes a slide-in overlay (shell); the table sits
  in an `overflow-x:auto` scroller (capture the horizontal scroll), and the
  impersonate quick-select row wraps (label / select / Go stack).

## Element(s) to crop
1. Heading + search card (idle, then "Searching…" disabled state).
2. Results card: the **Impersonate quick-select** row (label + select + Go).
3. The **users table** — show a `superAdmin: true` row (green "yes" pill +
   red "Revoke" button) AND a normal row (muted "no" + "Grant").
4. A row with NO name (`name` absent) → cell shows "—"; select option falls back
   to businessName / "Unnamed".

## Transient states to drive
1. **loading** — hard-reload `/admin`; capture the centered "Loading users…"
   before the list-all fetch resolves.
2. **empty** — search a phone with no match → centered "No users found.".
3. **list** — default populated table.
4. **busy** — click Grant/Revoke (or Impersonate); capture the "…" label +
   every action button disabled (drive by stalling the
   `/admin/users/:id/grant` response).
5. **error** — force an action to fail → red `role="alert"` banner above the
   table.
6. **impersonate** — pick a user in the quick-select (or click a row's
   Impersonate); the Go button enables. Clicking navigates to `/dashboard` as
   that user — to also capture the resulting global ImpersonationBanner, follow
   through and screenshot `/dashboard` (see shared-components/impersonation-banner).

## Motion
- None — no transitions/animations; busy is signalled by label swaps only.
  Nothing to film.
