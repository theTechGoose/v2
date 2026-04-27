# Verify Code Page — Root

> ✅ **Build in v1. Required for login flow.** Step 2 of the OTP login: enter the 6-digit code from the SMS sent during the landing-page step.

## Purpose

The contractor lands here after submitting their phone number on the landing page (or via a deep link from the SMS itself). Six single-character inputs (or one 6-digit input with auto-advance) accept the OTP. On success the backend sets the session cookie and redirects to `/dashboard`. On failure the inputs shake + clear + re-focus the first slot.

The page **does not exist in the prototype** — it's net-new, derived from the auth requirement. Visual treatment matches the landing's design system (mint surface, pink CTA, teal text, Nunito headings).

## Source

- Prototype: none — derived from `backend.md` §2.A
- Design system: reuse tokens from `paperwork-monsters/project/colors_and_type.css`
- Look-and-feel reference: the landing's contact-form card (mint card on teal bg, Nunito heading, pink primary CTA)

## Route

```
v2/frontend/routes/verify.tsx                       → "/verify?phone=…"
v2/frontend/routes/api/auth/verify.ts               → POST /api/auth/verify  (proxies to v2/backend POST /auth/verify-otp)
```

The phone number lands as a **query string** (`/verify?phone=%2B15125551234`) — the page reads it server-side from `url.searchParams.get('phone')`. Don't store it in client state — query string makes it deep-linkable from the SMS reply ("Enter this link to log in: …/verify?phone=…&prefill=937261").

If `phone` is missing, redirect to `/`.

## Layout (top-down)

```
<section.verify-card>
  <Brand />                              ← logo + wordmark, same as landing nav
  <h1>Check your phone</h1>
  <p>We just texted a 6-digit code to <strong>{phone formatted as (###) ###-####}</strong></p>
  <CodeInput />                          → components/code-input.md  (ISLAND)
  <p class="error" role="alert">         ← shown on bad code
  <button type="submit">Verify</button>  ← also auto-submits when 6th digit is entered
  <div class="meta">
    <a href="/">Wrong number? Edit</a>
    <button type="button">Resend code</button>  ← cooldown 30s
  </div>
</section>
```

## Page-level state

| State | Where | Default |
|---|---|---|
| `code` (6 chars) | `CodeInput` island | `""` |
| `submitting` | island | `false` |
| `error` | island | `null` |
| `cooldownSec` | island, ticks down from 30 after `Resend code` | `0` |

## Backend dependencies

- `POST /api/auth/verify` (Fresh proxy → backend `POST /auth/verify-otp`)
  - Body: `{ phoneNumber, code }`
  - Success → `{ sessionId, userId }`. The proxy sets `Set-Cookie: x-session-id=<sessionId>; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` (30 days) and returns `{ ok: true, redirectTo: '/dashboard' }`.
  - Failure → `{ ok: false, error: 'invalid_code' | 'expired' | 'rate_limited' }` — page renders the `<p class="error">`.
- `POST /api/auth/send-otp` (Fresh proxy → backend `POST /auth/send-otp`) — invoked by the "Resend code" button. Body must include `{ phoneNumber, language }` — `language` from the same `langSignal` that the landing page used (the signal persists across the route boundary). This keeps the OTP record's `language` consistent with the user's choice and ensures the resent SMS is in the right language. See `backend.md` §3.A "First-time signup language capture".

See `backend.md` §2.A.

## Auth

Public. The whole point of the page is to *establish* auth.

## Mobile breakpoints

The card is centered, max-width 440 px, full-width-with-margins below 480 px. The 6-digit input slots stay 44 px tall to remain touch-friendly. iOS triggers the SMS autofill suggestion above the keyboard if the input has `autocomplete="one-time-code"` + `inputmode="numeric"` — preserve both.

## i18n

Honor the same `langSignal` as the landing page so the toggle persists across the route boundary. Strings to localize:

| Key | EN | ES |
|---|---|---|
| `verify.h1` | Check your phone | Revisa tu celular |
| `verify.lead` | We just texted a 6-digit code to **{phone}** | Te enviamos un código de 6 dígitos a **{phone}** |
| `verify.cta` | Verify | Verificar |
| `verify.editPhone` | Wrong number? Edit | ¿Número incorrecto? Editar |
| `verify.resend` | Resend code | Reenviar código |
| `verify.resendIn` | Resend in {n}s | Reenviar en {n}s |
| `verify.errInvalid` | That code didn't match. Try again. | Ese código no coincide. Intenta de nuevo. |
| `verify.errExpired` | Code expired — request a new one. | El código expiró. Pide uno nuevo. |
| `verify.errRate` | Too many tries. Wait a minute and try again. | Demasiados intentos. Espera un minuto. |

## Implementation order

1. Wire the route + handler — read `?phone=` server-side, render the empty card.
2. Build `<CodeInput />` island (see component doc).
3. Wire `POST /api/auth/verify` proxy + cookie set.
4. Wire `Resend code` with 30 s cooldown.
5. Add the format-phone display in the lead paragraph (re-use `formatPhone()` from `landing/components/contact-form.md`).
6. Test: bad code → shake + clear; good code → cookie set + redirect to `/dashboard`.

## What NOT to do

- **Don't render this as a modal on the landing page.** Separate route — so the SMS deep link works on a different device.
- **Don't keep the phone number in `localStorage`.** Query string only; no client persistence.
- **Don't auto-resend on landing.** The user explicitly clicks "Resend code".
- **Don't block on cookie set.** Issue the cookie and `302` to `/dashboard` server-side; the client just follows.

## Edge cases

- **No `?phone=` param:** server-side `Response.redirect('/', 302)`.
- **Phone in URL doesn't match what the backend expects:** the backend keys OTP storage by `phoneNumber` — must be the exact normalized form sent in `POST /auth/send-otp`. Normalize in both places (the v2/backend `auth` module owns the normalizer; the landing `contact-form` and `/verify` page both call the same util).
- **Code expired (5-minute TTL):** error message + auto-disable the Verify button until they tap Resend.
- **Rate-limited (5 attempts/15min):** error message + disable Verify for the rate-limit window.
- **iOS SMS autofill:** with `autocomplete="one-time-code"`, iOS will suggest the code as a chip above the keyboard. Tapping it fills the input. Verify auto-submit fires after fill.
- **User opens /verify in a different tab:** the cookie is set on the response, applies app-wide. The tab they came from still works.
- **Already authenticated user lands on /verify:** server-side check the cookie; if valid, redirect to `/dashboard` immediately.
