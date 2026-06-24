# Page — `/admin`

Source route: `routes/admin/index.tsx` → `js/index.tsx`.
Route guard: `routes/admin/_middleware.ts` → `js/_middleware.ts`.

## Purpose
Super-admin operator console. Search users by phone, grant/revoke the
super-admin flag, and impersonate a user (swaps the session cookie server-side,
then full-navigates to `/dashboard` as that user). The global
`ImpersonationBanner` (shared) is the counterpart: once impersonating, it pins
to the top of every page with a "Return to your account" button. English-only
on purpose — it does not touch the i18n dictionaries.

## Auth / route gate (super-admin only)
`_middleware.ts` resolves the user via `loadUser(ctx.req)` (`GET /me`) and:
- no session → `302 /`,
- logged in but `superAdmin !== true` → `302 /dashboard`,
- else sets `ctx.state.user` and continues.
The flag is backend-resolved (can't be spoofed client-side), and every
`/admin/*` endpoint re-checks it server-side. **Capture requires a super-admin
session** (dev master OTP `000000` logs in, but the account must carry the
super-admin flag — see capture-checklist).

## App-shell composition (order)
Identical shell to the other authed pages:
```
<Head> …Admin · {brand} + /dashboard.css… </Head>
<div class="app">
  <DashSidebar active="admin" />          ← SHARED island
  <main class="main">
    <DashTopbar greetingDate greetingName />  ← SHARED island
    <div class="content">
      <AdminPage />                       ← PAGE ISLAND (components/admin-page)
    </div>
  </main>
</div>
```

## `<Head>`
- **Title:** `Admin · {tFor(lang, "brand.name")}` (only the "Admin" prefix is a
  literal; the brand name is i18n'd).
- **CSS:** `<link rel="stylesheet" href="/dashboard.css" />` — used only for the
  app-shell + tokens. AdminPage itself is entirely inline-styled (see
  `components/admin-page/css/admin-page.css`).

## SSR data
- `ctx.state.user` (from the middleware) is used ONLY for the topbar greeting +
  `lang`. **No admin data is server-rendered.** `AdminPage` fetches the user
  list client-side on mount (empty query → server returns everyone, capped).

## Sections (as AdminPage renders)
1. **Heading** — "Admin" + one-line subtitle (English literals).
2. **Search card** — `<form>` with a `type="search"` phone box + Search button.
3. **Error alert** (`role="alert"`) — conditional.
4. **Results card** (only when rows>0): an **Impersonate quick-select** row
   (label + `<select>` of loaded users + Go) above a **users table** (Name /
   Phone / Business / Super badge / Actions[Grant|Revoke + Impersonate]).
5. **Loading** / **No users found** centered states.

## Build order
1. Shell + tokens (shared) + the `_middleware` super-admin gate.
2. Build the `admin-page` island (see its `.md`): mount → list-all fetch →
   table; search; per-row toggle/impersonate; quick-select; error/loading/empty.
3. Verify against the shared `ImpersonationBanner` (the impersonate action's
   visible counterpart on subsequent pages).

## Local components
- `components/admin-page/` ← `islands/AdminPage.tsx` (239 lines).
