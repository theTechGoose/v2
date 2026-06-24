# Page: `/login`

**Route:** `routes/login.tsx` · **Source copied to:** `js/login.tsx` (route),
plus island in `components/login-form/`.

## Purpose
Dedicated phone-number entry screen for the passwordless **phone → OTP →
`/verify`** auth flow (roadmap p.13). First step of sign-in/sign-up (same
flow for both).

## Classification & data flow
- **Page tier:** mostly **static SSR** + one small island. `define.page` async
  handler. No client data fetch on the page itself.
- **Auth guard (server):** `loadUser(ctx.req)` → if already authenticated,
  **302 → `/dashboard`** (server redirect, before render). This is the correct
  PRG-style guard; keep it server-side.
- **Language (server):** `langFromCookie(cookie)` ?? `pickLangFromAcceptLanguage(accept-language)`
  — the saved cookie choice wins over the browser locale so the screen matches
  the language picked on the landing page. All copy via `tFor(lang, …)`.
- **The single island** is `<LoginForm>` (see `components/login-form/`), which
  owns the phone input + "send code" POST and the client-side nav to
  `/verify?phone=…`.

## `<Head>`
- `<title>{loginPage.title} · {brand.name}</title>`
- `<link rel="stylesheet" href="/verify.css">` — **shared with `/verify`**
  (same `.verify-shell` / `.verify-card` shell).

## Layout / composition order
```
.verify-shell                         (centered full-viewport shell, verify.css)
  .verify-card                        (white card, max-width, shadow)
    a.brand  → href="/"               (logo-monster.png 38×38 + "Paperwork" + <em>Monster</em> green)
    h1   loginPage.heading            (32px)
    p.muted  loginPage.subtitle       (--fg-muted, 16px)
    <LoginForm />                     ← ISLAND (phone field + submit)
```
Inline styles on the brand/h1/p; everything else from `verify.css`. The brand
mark here is the **image** logo (`/logo-monster.png`), not the CSS `.brand__mark`
glyph used in the app shell — note the two brand treatments.

## Components on this page
| Component | Where | Tier |
|---|---|---|
| `login-form` (`LoginForm`) | `pages/login/components/login-form/` | island — phone input, validation, POST send-otp, redirect to `/verify` |

No shared components (no app shell — this is a pre-auth screen).

## Capture checklist (auth-free → capture-ready)
- URL: `/login` (logged-out session; logged-in 302s away — clear `pm_session`
  cookie first).
- Viewports: 390 (mobile), 768, 1280. `verify.css` is a single-column centered
  card at all widths — verify its own `@media` in `verify.css`.
- States to shoot: empty, focused phone field, invalid number error, submitting
  (drive via the island). Light theme only.

## Build order
design tokens → `verify.css` shell → `login-form` island → this page.
