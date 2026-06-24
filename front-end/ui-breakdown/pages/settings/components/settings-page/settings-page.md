# SettingsPage

The whole `/settings` content area as a single island. Fetches the composite
`ProfileSnapshot` on mount and edits it in place across seven cards. Source:
`islands/SettingsPage.tsx` (1314 lines). **Pragmatic spec:** macro structure +
all sections + states, not every line.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/SettingsPage.tsx`).
- **Interaction tier:** **whole-page island, client-only.** No form POST/PRG, no
  Fresh Partial. All persistence is client `fetch` → JSON API → optimistic-ish
  local state update.
- **Server actions + feedback** (each card owns its own busy/error/saved):
  - Account: `profileClient.updateUser(patch)` → `PUT /me`.
  - Identity (business name, logo, comms languages):
    `profileClient.updateIdentity(patch)` → `PUT /profile/identity`.
  - Address: `updateAddress` → `PUT /profile/address`.
  - Insurance: `updateInsurance` → `PUT /profile/insurance`.
  - Tax: `updateTax` → `PUT /profile/tax`.
  - Payments: `updateIdentity({ acceptedPaymentMethods })` (whole object,
    shallow-merged so untouched methods survive).
  - Logo / cert / W-9 uploads: `filesClient.uploadBlob(file)` → `POST /files`
    → returns `FileRecord`, then the file id is saved via the relevant
    `update*`. A 413 with `body.code === "file_too_large"` surfaces the
    "too large" copy; anything else → generic per-card message (raw error
    `console.error`'d, never shown).
  - **Danger Zone:** `profileClient.wipeAccount()` → **`GET /me/wipe`**
    (irreversible; nukes user + 100% of data — PROJECT FACT), then
    `globalThis.location.href = "/login"`.
  - **Flash/feedback pattern:** `EditPanel` shows "Saving…" while busy, then
    "Saved" (green) on success; errors render a red line under the card. Most
    text fields **save on blur** when the value changed; Payments + Danger Zone
    use explicit buttons.
- **Client state owned:**
  - Top island: `s = { loading, error, profile: ProfileSnapshot|null }`.
  - Per-card local `useState` for each field + `busy` (string-tagged in
    EditCard/Insurance/Tax: `"user"|"identity"|"logo"|"fields"|"file"|"save"`)
    + `err` + `saved`. Payments owns a `Record<key,{enabled,value,confirm}>`.
    Danger Zone owns `confirm` (armed when `=== "DELETE"`).
  - `onSaved(partial)` lifts each saved sub-entity back into `s.profile` so
    neighbouring cards stay in sync **without a refetch** (no
    `location.reload()` for saves — good).
- **`location.href` flags (NOT reload, but full navigation):**
  - Danger Zone → `/login` (justified: all sessions are dropped server-side).
  - There is **no other reload**; saves mutate local state only.
- **Language signal:** the app-language `<select>` calls `setLang(v)`
  (`lib/i18n.ts` `langSignal`) which flips the **entire app instantly** (signal)
  AND persists via `saveUser({language})`. `tr()` re-reads `langSignal.value` so
  the whole screen re-renders in the new language with no reload.
- **Data source per region + honest-empty:** single `GET /profile` →
  `ProfileSnapshot`. Read-only `Card`s filter out empty fields and show
  `settings.nothingSet` ("Nothing set yet") when all are blank. The masked TIN
  (`tax.tinMasked`) is the only thing shown for tax; the raw TIN is never
  returned.
- **Liveness:** request-response only. One fetch on mount; no polling/socket.
- **Data-shape hazards:**
  - `coverageCents` is CENTS — the UI divides by 100 to show dollars and
    multiplies back on save (`Math.round(Number*100)`). A non-numeric entry
    guards with `!Number.isNaN`.
  - `commsLanguages?: string[]` falls back to legacy single `commsLanguage`, and
    the toggle **refuses to let the set hit zero** (always ≥1 enabled).
  - `acceptedPaymentMethods` is `Partial<Record<PaymentMethodKey, …>>`; the card
    spreads the existing object so methods it doesn't render (`other`) survive.
  - Money-routing handles (Venmo/Zelle/CashApp/PayPal) are **required + retype-
    confirmed** when enabled; check `mailTo` / ACH+card `instructions` are
    optional and skip the confirm field.

## 2. Anatomy
```
<>                                          ← island root (loading→skeleton; error→.dashpage-error)
  <section class="hero" style="grid-template-columns:1fr">
    <div class="hero__copy">
      <h1 class="hero__title"> businessName ?? displayName ?? user.name ?? "Your business" </h1>
      <p class="hero__sub"> settings.heroSub </p>
  <div class="grid">                        ← read-only summary
    <Card "Account">  name · phone(fmtPhone) · email · language </Card>
    <Card "Business identity">  businessName · legalName · license </Card>
  <EditCard>                                ← .panel (EditPanel shell)
    name | email | businessName  (save-on-blur)
    [Upload/Replace logo]  + logo hint
    app-language <select>  (setLang + persist)
    comms-languages [en][es] toggle chips (≥1)
  <div class="grid">
    <AddressEditCard>  street | city | state(2) | zip | country  (save-on-blur)
    <InsuranceEditCard>  provider | policy | coverage($) | expires(date) + [Upload cert]
  <div class="grid">
    <TaxEditCard>  TIN(masked-on-file) save-on-blur + [Upload W-9]
    <Card "Contract defaults">  net terms · deposit% · warranty days
  <PaymentsEditCard>                         ← per-method toggle rows + retype-confirm + [Save]
  <DangerZoneCard>                           ← .panel red; type "DELETE" → [Wipe]
</>
```
- **Shared building blocks:** `Skeletons` (`ShimmerStyle`, `PageHeaderSkeleton`,
  `CardGridSkeleton rows={2}`) for the loading state — see shared-components.
- **Class hooks present but UNSTYLED (FLAG):** `.settings-edit__input` on the
  name/email/business inputs has no CSS rule anywhere; the `inputStyle` inline
  string does all the styling. `.dashpage-error` (error branch) is likewise
  undefined in any stylesheet.

## 3. Props
None. The island fetches its own data.

| name | type | default | control | signal? |
|---|---|---|---|---|
| — | — | — | — | — |

Sub-card props are internal: each editor takes `{ snapshot: ProfileSnapshot,
onSaved: (partial) => void }`; `DangerZoneCard` takes `{ snapshot }` (unused).
These are not isolate controls (the island has no props) — for isolation, drive
via `_signals` (the `s` state) — see isolate cases.

## 4. States → cases
| state | meaning | case |
|---|---|---|
| loading | mount, `GET /profile` in flight → Shimmer + PageHeader + CardGrid skeletons | `cases/loading/loading.json` |
| error | fetch failed / no profile → `.dashpage-error` message | `cases/error/error.json` |
| loaded | full profile rendered, all cards idle | `cases/loaded/loaded.json` |
| danger-armed | "DELETE" typed → wipe button armed (red, enabled) | `cases/danger-armed/danger-armed.json` |
| payments-mismatch | enabled handle ≠ confirm → red border + "doesn't match" | `cases/payments-mismatch/payments-mismatch.json` |

(Other transient sub-states — per-card "Saving…"/"Saved", upload "Uploading…",
file-too-large error — are documented in Events/§5 and captured via the
capture-checklist, not separate isolate cases, since they're momentary.)

## 5. Events
- **Save-on-blur (text fields):** `ev.expect(e => e.type === "blur" &&
  e.source.startsWith("input") && /* value !== was */)` → the card's
  `save*(patch)` → busy → "Saved"/error. Fires only when the trimmed value
  changed.
- **App-language select:** `ev.expect(e => e.type === "change" &&
  e.source === "select.app-language")` → `setLang(v)` (instant whole-app
  re-render) + `saveUser({language})`.
- **Comms-language toggle:** `change` on a checkbox → recompute set (never
  empty) → `saveIdentity({commsLanguages, commsLanguage})`.
- **Logo / cert / W-9 buttons:** `click` → hidden `<input type=file>.click()`;
  the input's `change` → `uploadBlob` → save file id.
- **Payments Save:** `click` on the primary button → validate every enabled
  required handle has a matching confirm → `updateIdentity`.
- **Danger Zone:** `input` on the confirm field arms when `=== "DELETE"`;
  `click` on the (armed) wipe button → `wipeAccount()` → redirect `/login`.

## 6. Motion
- The island itself has **no keyframes**. Motion comes entirely from the
  **Skeletons** shimmer during load (see shared-components/skeletons — that
  `@keyframes shimmer` is the only animation here) and the panel/hero static
  shadows.
- **Jank watch:** none specific to this island; the hero's layered radial
  gradients are static.
- **Reduced-motion:** the global token CSS clamps animation/transition durations
  to `0.01ms !important`; the shimmer respects it via the shared Skeletons. No
  local reduced-motion block needed.

## 7. Responsive
- No `@media` of its own. The borrowed `.hero`/`.grid` collapse to one column at
  **`max-width: 640px`** (dashboard.css), so the read-only pairs and
  Address/Insurance/Tax pairs stack on phones.
- The editable field grids are intrinsically responsive:
  `grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))` — they reflow
  without a media query.
- The shell adds keyboard-clearing bottom padding (`--kb-inset`) on phones so the
  Danger Zone field scrolls above the soft keyboard (shell-owned).

## 8. A11y
- Every input is wrapped in a `<label>` with an uppercase caption `<span>`; the
  three free-text identity inputs also carry explicit `aria-label`
  (`settings.aria.editName/editEmail/editBusinessName`). Hidden file inputs have
  `aria-label`s (`aria.logoFile/insuranceCertFile/w9File`).
- The Danger Zone confirm input has `aria-label` (`aria.wipeConfirm`); the wipe
  button is `disabled` until armed.
- **Gaps:** the per-card "Saving…/Saved" status is a plain `<span>` (no
  `aria-live`), so SR users aren't announced save completion; the payment
  mismatch error likewise isn't a live region.

## 9. Used on
`/settings` only — `routes/settings/index.tsx` mounts `<SettingsPage />` inside
`<div class="content">`. Single instance. (The shared `SetupChecklist` on the
dashboard pulls from the same `/profile` endpoint but is a separate component.)
