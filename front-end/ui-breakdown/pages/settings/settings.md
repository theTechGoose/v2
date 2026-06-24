# Page — `/settings`

Source route: `routes/settings/index.tsx` → `js/index.tsx`.

## Purpose
The contractor's account & business profile editor. Loads the composite
`ProfileSnapshot` (user + the five business sub-entities) and lets the
contractor edit everything in place: account fields, business identity + logo,
mailing address, insurance (+ cert upload), tax (TIN + W-9 upload), contract
defaults (read-only here), accepted payment methods (with a retype-to-confirm
guard), the contractor's own app language (en/es), the set of outbound comms
languages, and a **Danger Zone** that irreversibly wipes the account and 100%
of its data via `GET /me/wipe` (PROJECT FACT — manual, type-"DELETE"-to-arm).

## App-shell composition (order)
The route is a server page (`define.page`) that assembles the standard authed
app-shell, then mounts the page island:

```
<Head> …title + /dashboard.css… </Head>
<div class="app">                         ← shell (SHARED)
  <DashSidebar active="settings" />       ← SHARED island
  <main class="main">
    <DashTopbar greetingDate greetingName />  ← SHARED island
    <div class="content">
      <SettingsPage />                    ← PAGE ISLAND (components/settings-page)
    </div>
  </main>
</div>
```
- `DashSidebar`, `DashTopbar` → **shared-components/** (reference only).
- `ImpersonationBanner` is mounted globally in `routes/_app.tsx` (also shared) —
  it pins above this page during a super-admin impersonation session.

## `<Head>`
- **Title:** `tFor(lang, "settingsRoute.docTitle")` (i18n; en/es per
  `user.language`).
- **CSS:** `<link rel="stylesheet" href="/dashboard.css" />` — the ONLY
  stylesheet. There is no `settings.css` in the live app; SettingsPage reuses
  dashboard's `.hero`/`.grid`/`.panel` and inline-styles the rest. (Extracted
  to `css/settings.css` + the component's `css/settings-page.css` here.)

## SSR data
- The route reads `ctx.state.user` (resolved by the global auth middleware via
  `GET /me`) ONLY to compute the topbar greeting (`greetingName`,
  `greetingDate`) and pick `lang`. **No profile data is fetched server-side** —
  `SettingsPage` fetches `GET /profile` (ProfileSnapshot) client-side on mount.
  So first paint is the skeleton, not server-rendered content.

## Sections (top → bottom, as SettingsPage renders)
1. **Hero** — `.hero` (1-col): business/display/user name as title + tagline.
2. **Read-only summary grid** (`.grid`): **Account** card + **Business
   identity** card (honest-empty → "Nothing set yet" when blank).
3. **Edit details** card (`EditCard`): name, email, business name (save on
   blur), logo upload, **app language** select (flips whole app instantly via
   `langSignal` + persists), **comms languages** checkboxes.
4. **Address + Insurance** grid: `AddressEditCard` (save-on-blur) +
   `InsuranceEditCard` (fields save-on-blur + cert file upload).
5. **Tax + Contract-defaults** grid: `TaxEditCard` (TIN save-on-blur + W-9
   upload; raw TIN never returns, only masked) + read-only **Contract
   defaults** card.
6. **Payment methods** card (`PaymentsEditCard`): per-method enable toggle +
   handle entry with retype-to-confirm; one explicit Save button.
7. **Danger Zone** card (`DangerZoneCard`): type-"DELETE" to arm → wipe.

## Build order
1. Tokens + `/dashboard.css` shell (shared) in place; app-shell mounting.
2. `css/settings.css` (hero/grid/panel) loaded via the route's single
   dashboard.css link.
3. Build the `settings-page` island (see its `.md`): fetch → skeleton →
   loaded; then each sub-card (read-only Card, EditPanel shell, then the five
   editors), then PaymentsEditCard, then DangerZoneCard last.
4. Wire the language signal + per-card `onSaved` lift.

## Local components
- `components/settings-page/` ← `islands/SettingsPage.tsx` (1314 lines; the
  whole page is one island; sub-cards are in-file function components, not
  separate files — documented as one component with macro structure).
