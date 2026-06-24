# PublicAcceptQuote

The "Accept this quote" island — a type-your-name e-sign that POSTs an acceptance
for the customer-facing quote at `/q/:id`. Renders below the SSR'd quote summary.
On success it swaps to a green confirmation card.

Source: `islands/PublicAcceptQuote.tsx` (copied to `js/PublicAcceptQuote.tsx`,
152 lines). Mounted by `PublicQuoteActions`, NOT directly by the page.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/PublicAcceptQuote.tsx`).
- **Interaction tier:** `island` — local state + a single mutating `fetch`.
- **Client state owned:**
  - `name: string` — typed full name (used as both `name` and `signature`).
  - `submitting: boolean`.
  - `status: "idle" | "ok" | "error"` (seeded to `"ok"` when `initialAccepted`).
  - `err?: string` (friendly, localized).
- **Server mutation (action endpoint):** `POST /api/quotes/:id/accept` JSON
  `{ name, signature }` when a name was typed, else `{}`. Same-origin via Fresh's
  `/api` proxy — the source comment notes this avoids the CORS an absolute
  `localhost:3000` URL would trip in the browser. Body is JSON because the
  backend `@Body()` parser needs JSON (a plain form POST parses to an empty
  object).
- **Flash / feedback:** inline. Submit label → `publicAcceptQuote.submitting`
  ("Accepting…"); the button is disabled until a name is typed. On success →
  green "✓ Quote accepted" card with a contractor-named follow-up sentence. No
  toast, no redirect.
- **Logical-failure handling:** like the actions island — a 200 with
  `{ok:false, reason:"already_accepted"|"already_declined"}` is re-thrown and
  mapped by `friendlyError()` to a localized sentence; raw payload never shown.
- **`initialAccepted` prop:** when the parent (`PublicQuoteActions`) remounts this
  island for an already-accepted quote, it passes `initialAccepted` so `status`
  starts `"ok"` and it renders the success card immediately.
- **Liveness:** request-response only. No polling/socket.
- **Data source:** none — `quoteId`, `contractorFirstName`, `lang` are props.

### Anti-patterns
- **No `location.reload()`** — good; resolution is in-state via `status`/
  `onAccepted`. Flag any rebuild that tries to reload to "show the accepted state."

### Reactivity / i18n
- `lang` prop (`"en"|"es"`, default `"en"`), all strings via `tFor(lang,…)`. Not
  reactive to `langSignal` (no on-page toggle).

## 2. Anatomy (inline styles captured)
### Idle / form
```
<form onSubmit=onAccept style="margin-top:24px;text-align:left">
  <label style="font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:#6b7a7e;margin-bottom:6px">
    "Type your full name to sign"
  <input type=text required autoComplete=name aria-describedby="accept-hint"
    placeholder="Jane Doe"
    style="width:100%;padding:12px 14px;border:1px solid #e3e8e6;border-radius:10px;font-size:15px;color:#1c2c30;background:#fff">
  {!name && !err && <div id="accept-hint" style="margin-top:8px;color:#6b7a7e;font-size:12px">
    "Type your name above to enable the Accept button."}
  {err && <div style="margin-top:10px;color:#b3261e;font-size:13px"> "Couldn't accept — " + msg}
  <button type=submit disabled aria-disabled
    style="margin-top:16px;width:100%;background:{bg};color:#fff;border:0;font-weight:800;font-size:15px;padding:14px 28px;border-radius:12px;box-shadow:0 6px 14px rgba(81,152,67,0.35);cursor:{ptr}">
    label = submitting ? "Accepting…" : "Accept this quote →"
</form>
```
- **Button bg:** enabled `#519843`; **disabled `#7a9a73`** (darker muted teal —
  source comment cites audit P5.4 for AA contrast on white text).

### Success (status==="ok")
```
<div style="margin-top:24px;background:rgba(81,152,67,0.10);border:1px solid rgba(72,158,95,0.30);border-radius:14px;padding:18px 20px;text-align:center">
  <div style="font-weight:800;color:#519843;font-size:16px"> "✓ Quote accepted"
  <div style="margin-top:6px;color:#6b7a7e;font-size:13px">
    who ? "{Marcus} will be in touch to schedule." : "Your contractor will be in touch to schedule."
</div>
```

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `quoteId` | string (required) | — | text | no |
| `contractorFirstName` | string? | `undefined` (→ generic success sub) | text | no |
| `initialAccepted` | boolean | `false` (→ seeds `status="ok"`) | boolean | no |
| `lang` | `"en"\|"es"` | `"en"` | select | no |

(`onAccepted` is internal wiring to the parent island — drive via Events, not a prop control.)

## 4. States → cases
| state | meaning | case |
|---|---|---|
| idle | empty name → button disabled (`#7a9a73`) + hint shown | `cases/idle/idle.json` |
| filled | name typed → button enabled (`#519843`), hint gone | `cases/filled/filled.json` |
| submitting | `submitting=true` → "Accepting…", disabled | `cases/submitting/submitting.json` |
| success | `status="ok"` (or `initialAccepted`) → green ✓ card | `cases/success/success.json` |
| error | `status="error"` → inline "Couldn't accept — …" | `cases/error/error.json` |
| es | Spanish strings | `cases/es/es.json` |

## 5. Events
- `e.source==="input.name" && e.type==="input"` → `setName(value)` (enables button when non-empty).
- `e.source==="form.accept" && e.type==="submit"` → `POST /api/quotes/:id/accept`
  → on ok `status="ok"` + `onAccepted()`.

## 6. Motion (real CSS only)
- **None.** No keyframes/transitions in source. The `box-shadow:0 6px 14px
  rgba(81,152,67,0.35)` on the submit button is static (no hover transition
  declared). State swaps are instant. No reduced-motion concern.

## 7. Responsive
- Full-width within the page's 640px cap; `width:100%` input + button stack. No
  own `@media`.

## 8. A11y
- `<input required aria-describedby="accept-hint">` with a hint div carrying that
  id — good wiring. Button has `aria-disabled` mirroring `disabled`.
- **Gaps:** the inline error div has no `role="alert"`/`aria-live`, so a screen
  reader won't announce an accept failure; success card isn't focused on resolve.
  Rebuild fix: add `role="alert"` to the error and move focus to the success card.

## 9. Used on
`/q/:id`, mounted by `PublicQuoteActions` (rendered while `resolved!=="declined"`,
and again with `initialAccepted` once `resolved==="accepted"`).
