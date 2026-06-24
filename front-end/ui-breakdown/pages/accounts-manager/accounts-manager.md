# Page — `/accounts-manager`

Source route: `routes/accounts-manager/index.tsx` → `js/index.tsx` (39 lines).

## Purpose — HONEST-EMPTY (stub)
A **blank-slate** surface, separate from the contractor `/dashboard`. As of this
snapshot it renders the standard app-shell with **no content and no local
components**. The route's own doc comment says it plainly:

> "Uses the regular app shell — sidebar rail + topbar + main content — but the
> sidebar carries NO nav tabs yet (showNav={false}) and the content area is a
> blank slate. Build the accounts-manager surface out from the
> `<div class="content">` below, and add tabs back to the rail when there are
> pages to point at."

There is **no island, no page-local component, and no extracted component CSS**
— inventing any would misrepresent the source. This folder documents the shell
composition only.

## App-shell composition (order)
```
<Head> …Accounts Manager + /dashboard.css… </Head>
<div class="app">
  <DashSidebar showNav={false} />     ← SHARED island, nav tabs OFF
  <main class="main">
    <DashTopbar greetingName />       ← SHARED island, greeting only (NO greetingDate)
    <div class="content">
      {/* Blank slate — build the accounts-manager view here. */}
    </div>
  </main>
</div>
```
Two deliberate shell differences vs `/settings` and `/admin`:
- `DashSidebar` is mounted with **`showNav={false}`** → the nav rail renders no
  tabs (rail chrome only). (See shared-components/dash-sidebar for the prop.)
- `DashTopbar` receives **only `greetingName`** — no `greetingDate` is computed
  or passed (the route doesn't build the weekday/month string the other two do).

## `<Head>`
- **Title:** literal `Accounts Manager` (NOT i18n'd, unlike settings/admin).
- **CSS:** `<link rel="stylesheet" href="/dashboard.css" />` — shell + tokens
  only; no content to style.

## SSR data
- `ctx.state.user` → `greetingName` and `lang` only. Nothing else fetched or
  rendered.

## Build order
1. Mount the shared shell with `showNav={false}` and greeting-only topbar.
2. Stop. The content area is intentionally empty — build future
   accounts-manager components into `components/` and add them here, plus
   restore sidebar nav tabs, when there are pages to point at.

## Local components
- **None.** Empty content area by design.
