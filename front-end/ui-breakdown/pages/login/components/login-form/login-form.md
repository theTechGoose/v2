# LoginForm

The phone-entry form on `/login`. Collects a US phone number, POSTs an OTP
request, then navigates to `/verify`. Reuses the exact OTP flow as the landing
contact form, but rendered as a clean island inside the `.verify-card`.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/LoginForm.tsx`).
- **Interaction tier:** `island` (client-only state) that performs a **server
  mutation via fetch + manual navigation** (not form+PRG; it's a JS submit
  handler that calls the API client then sets `location.href`).
- **Client state owned (`useState`):**
  - `phone: string` — raw input value; displayed through `formatPhoneDisplay`
    (`(555) 123-4567` mask) but stored raw.
  - `submitting: boolean` — disables the button + swaps its label to `…`.
  - `err: string | null` — inline error text (rendered as `<p role="alert">`).
  - reads `langSignal.value` (via `t()`) so labels localize live.
- **Server mutation + feedback:**
  - `onSubmit` → `e.preventDefault()` → normalize to E.164 (`toE164`) → guard
    `< 10 digits` (sets `loginForm.phoneIncomplete`) → `landingClient.sendOtp(
    { phoneNumber, language: lang })` → **POST `/api/auth/send-otp`**.
  - **Success:** `globalThis.location.href = "/verify?phone=<e164>&lang=<lang>"`
    — a full navigation to the verify page (acceptable: it's a step transition,
    not a refresh-after-mutation-in-place). No flash/toast; the verify page is
    the feedback.
  - **Failure:** `err = "Error: <status>"` for an `ApiError`, else
    `loginForm.sendFailed`. Button re-enables (`finally`).
- **Liveness:** request-response only (one POST). No polling/ws.
- **Anti-pattern check:** NOT the frozen-SSR-props + `location.reload()`
  whole-page island anti-pattern. It owns only its own form state and navigates
  forward on success. The only smell: `toE164` assumes a US `+1` when 10 digits
  are entered, and the `< 10` guard uses `e164.replace(/\D/g,"").length` which
  for a leading `+1` counts 11 — so a 9-digit entry "+1xxxxxxxxx" can slip past;
  minor. No reload to flag.
- **Data-shape hazards:** the displayed value (`formatPhoneDisplay(phone)`) is
  derived on every render from the raw `phone` state — typing non-digits is
  silently stripped. `autoFocus` on the input (focus on mount).

## 2. Anatomy (all elements INLINE-styled; no class hooks — see css/login-form.css)
```
<form onSubmit=onSubmit>                       ← flex column, gap 14, left-aligned
  <label>
    <span>{t("loginForm.phoneLabel")}</span>   ← caption
    <input type=tel inputMode=numeric autoComplete=tel autoFocus
           value={formatPhoneDisplay(phone)} placeholder={t phonePlaceholder}
           required />
  </label>
  {err && <p role="alert">{err}</p>}           ← #a83b3b
  <button type=submit disabled={submitting}>{submitting ? "…" : t submit}</button>
  <p>{t("loginForm.helper")}</p>               ← centered fine print
</form>
```
Rendered inside the route's `.verify-card` (login.tsx), under a `.brand` link,
an `<h1>` ("Welcome back") and a `.muted` subtitle.
- **Slots/children:** none.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| (none) | — | — | — | — |

LoginForm takes **no props**. All copy comes from `t(…)` keyed off `langSignal`;
behavior is self-contained. (Cases below drive internal `useState` via `_signals`.)

## 4. States → cases
| state | meaning | case |
|---|---|---|
| default | empty input, autofocused, button enabled | `cases/default/default.json` |
| filled | a formatted phone typed in | `cases/filled/filled.json` |
| submitting | POST in flight: button disabled, label `…` | `cases/submitting/submitting.json` |
| error | send failed / incomplete → red `<p role=alert>` | `cases/error/error.json` |
| es | Spanish labels (`langSignal="es"`) | `cases/es/es.json` |

## 5. Events
- `ev.expect(e => e.source==="form" && e.type==="submit")` → `onSubmit`:
  validates, POSTs `/api/auth/send-otp`, navigates to `/verify?phone=…&lang=…`.
- `ev.expect(e => e.source==="input[type=tel]" && e.type==="input")` →
  `setPhone(value)` (re-masked on render).
- `ev.expect(e => e.source==="button[type=submit]" && e.type==="click")` →
  native form submit (same path as the submit event).
- External (received): `langSignal` change → re-render with new `t()` strings.

## 6. Motion (extracted)
- **None of its own.** No CSS animation/transition on any LoginForm element
  (everything is inline-styled with no `transition`). The submit label simply
  swaps text to `…` while `submitting`. (The page chrome `.verify-card` has the
  `--shadow-lg` static shadow; the `.btn` family transitions live elsewhere and
  this button is NOT a `.btn` — it's a bespoke inline-styled `<button>`.)
- **Reduced motion:** N/A.

## 7. Responsive
- No `@media` of its own. The input is `width:100%` inside the `.verify-card`
  (max-width 440px), so it scales with the card. The verify-shell re-centers the
  card above the iOS soft keyboard via `--vvh`/`--vvt` (MobileViewport island) —
  see verify.css `.verify-shell`.

## 8. A11y
- Real `<form>` + `<label>`-wrapped `<input type="tel" inputMode="numeric"
  autoComplete="tel" required>` — native semantics, mobile numeric keypad,
  browser tel autofill. `autoFocus` lands the caret on mount.
- Error is announced via `<p role="alert">`.
- **Gaps:** the submit button has no busy `aria` beyond the disabled state +
  `…` text (consider `aria-busy`); the input has no `aria-describedby` tying it
  to the error or helper text.

## 9. Used on
- **`/login`** only (`routes/login.tsx` line 60). Page-local island.
- NOT the same as the dead `islands/ContactForm.tsx` (the landing contact form
  is inline markup in `routes/index.tsx` driven by `static/landing-scripts.js`).
  Both hit the same `POST /api/auth/send-otp` endpoint, but LoginForm is the
  only live OTP-request island.
