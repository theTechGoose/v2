# AdminPage

The whole `/admin` content area as a single island — a super-admin user console.
Source: `islands/AdminPage.tsx` (239 lines). English-only operator tool;
entirely inline-styled.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/AdminPage.tsx`).
- **Interaction tier:** **whole-page island, client-only**, with three
  server mutations. No form PRG (the search `<form onSubmit>` `preventDefault`s
  and fetches), no Fresh Partial.
- **Server actions + feedback:**
  - **Search:** `adminClient.search(q.trim())` → `GET /admin/users?q=` →
    `AdminUserView[]`. Submit button reads "Searching…" + `disabled` while
    `loading`.
  - **List-all on mount:** `useEffect` calls `search()` with empty `q` →
    server returns everyone (capped). So the table is populated before any
    typing.
  - **Grant/Revoke:** `toggleSuper(u)` → `adminClient.grant(id)` /
    `adminClient.revoke(id)` → `POST /admin/users/:id/{grant|revoke}` →
    returns the updated `AdminUserView`, spliced into `rows` in place (no
    refetch). Row button reads "…" while `busyId === u.id`.
  - **Impersonate:** `impersonate(id)` → `adminClient.impersonate(id)` →
    `POST /admin/impersonate/:id` (server swaps the `pm_session` cookie), then
    `globalThis.location.href = "/dashboard"`.
  - Errors from any action surface in a single `role="alert"` banner above the
    table (`error` state); the action's `busyId` is cleared on failure so the
    UI re-enables.
- **`location.href` flag (full navigation, NOT reload):** impersonate →
  `/dashboard`. **Justified** — the session identity changed server-side, so the
  whole app must rebuild as the target user. Same pattern (and same fix note) as
  the shared `ImpersonationBanner`'s "Return to your account": the clean rebuild
  is a server **PRG** (`303 → /dashboard`) instead of a client `location.href`,
  avoiding a flash of the admin page as the new user. This is the impersonation
  ENTRY; `ImpersonationBanner` is the EXIT — they are counterparts.
- **Client state owned:** `q` (search), `rows: AdminUserView[]`, `loading`,
  `busyId: string|null` (which row's action is in flight — gates ALL action
  buttons), `error: string|null`, `impersonateId` (quick-select value).
- **Data source + honest-empty:** single `GET /admin/users` (re-run on search).
  Empty result → centered "No users found." (and a separate "Loading users…"
  while the first fetch is in flight with no rows yet).
- **Liveness:** request-response only; no polling.
- **Data-shape hazards:** `AdminUserView` is the search projection
  (`id, name?, phoneNumber, businessName?, superAdmin`). Display name falls back
  `name || businessName || "Unnamed"` (select) / `name || "—"` (table). Phones
  run through `fmtPhone`. `busyId` is a single value, so **only one row action
  can be in flight at a time** — every action button is disabled while any is
  busy.

## 2. Anatomy
```
<div style={wrap}>                                  ← .admin-wrap (max 980px)
  <div>  <h1>Admin</h1>  <p>Search users, grant or revoke…</p>  ← .admin-head
  <div style={card}>                                ← .admin-card (search)
    <form onSubmit=search>
      <input type=search inputMode=tel placeholder="Search by phone…" />
      <button type=submit> {loading?"Searching…":"Search"} </button>
  { error && <div role="alert">{error}</div> }      ← .admin-alert
  { rows.length>0 && (
    <div style={card}>                              ← .admin-card (results)
      <div> Impersonate  <select>…users…</select>  <button>Go</button>  ← quick-select row
      <div style="overflow-x:auto">
        <table>                                     ← .admin-table
          <thead> Name | Phone | Business | Super | Actions
          <tbody> per row:
            name | fmtPhone | business | <badge yes|no> |
              [Grant|Revoke (danger if super)]  [Impersonate]
  ) }
  { loading && rows.length===0 && "Loading users…" }   ← .admin-state
  { !loading && rows.length===0 && "No users found." } ← .admin-state
</div>
```
- **All styling inline** (module consts: `wrap, card, inputStyle, btnPrimary,
  btnSecondary, btnDanger`). No stylesheet classes — see
  `css/admin-page.css` for the extracted rules. The super-badge "yes" pill is
  green (`#e7f3e3`/`#2f6d29`); "no" is muted text.

## 3. Props
None. The island fetches its own data; it only renders for a super-admin (route-
gated).

| name | type | default | control | signal? |
|---|---|---|---|---|
| — | — | — | — | — |

For isolation, drive via `_signals` (the `rows`/`loading`/`error`/`busyId`
state).

## 4. States → cases
| state | meaning | case |
|---|---|---|
| loading | first fetch in flight, no rows yet → "Loading users…" | `cases/loading/loading.json` |
| empty | fetch done, zero users → "No users found." | `cases/empty/empty.json` |
| list | populated table + quick-select | `cases/list/list.json` |
| busy | a Grant/Revoke or Impersonate in flight (`busyId` set; all actions disabled, button reads "…") | `cases/busy/busy.json` |
| error | a call failed → red `role="alert"` banner above table | `cases/error/error.json` |
| impersonate-select | a user chosen in the quick-select (Go enabled) | `cases/impersonate-select/impersonate-select.json` |

## 5. Events
- **Search submit:** `ev.expect(e => e.type === "submit" &&
  e.source === "form.admin-search")` → `preventDefault` → `setLoading(true)` →
  `search(q.trim())` → `setRows`.
- **Search typing:** `input` on the search box → `setQ`.
- **Grant/Revoke:** `ev.expect(e => e.type === "click" &&
  e.source === "button.admin-toggle-super")` → `toggleSuper(u)` →
  grant|revoke → splice updated row. (Disabled while `busyId !== null`.)
- **Impersonate (row button):** `click` → `impersonate(u.id)` → redirect
  `/dashboard`.
- **Quick-select:** `change` on `<select#impersonate-select>` → `setImpersonateId`;
  Go button `click` (disabled until a user is picked and nothing busy) →
  `impersonate(impersonateId)`.

## 6. Motion
- **None.** No keyframes, no transitions — buttons swap text labels
  ("Search"→"Searching…", "Grant"/"Revoke"→"…") to signal busy. Nothing to film.
- **Reduced-motion:** N/A (no motion).

## 7. Responsive
- **No `@media` of its own.** The table is wrapped in
  `style="overflow-x:auto"` so on narrow viewports it scrolls horizontally
  rather than reflowing. The `wrap` const is `max-width:980px;margin:0 auto`.
  The impersonate quick-select row is `flex-wrap:wrap` so its label/select/Go
  stack on narrow screens.
- Verify at the shell breakpoint (`max-width: 640px`, where the sidebar becomes
  an overlay) and at 980px (the content max-width).

## 8. A11y
- Search box has `aria-label="Search users by phone number"`; the impersonate
  `<select>` is associated to its `<label for="impersonate-select">`.
- The error banner is `role="alert"` (assertive announce on failure).
- All action controls are real `<button type="button">`/`type="submit"` with
  `disabled` while busy.
- **Gaps:** the "Loading users…"/"No users found." states are plain text (no
  `aria-live`/`aria-busy` on the table region), so SR users get no progress
  announcement for the table itself.

## 9. Used on
`/admin` only — `routes/admin/index.tsx` mounts `<AdminPage />`, gated by
`routes/admin/_middleware.ts` (super-admin). Single instance. Its impersonate
action's runtime counterpart is the global `ImpersonationBanner`
(shared-components/), shown on every page while impersonating.
