# PublicQuoteActions

The customer-facing actions panel under the SSR'd quote summary on `/q/:id`.
Three modes — **Accept** (delegated to the `PublicAcceptQuote` island), **Decline**
(reason chips + note + name), and **Ask a question** (question + contact + name).
Once the quote is resolved (accepted OR declined) both secondary buttons vanish so
the customer cannot fire a second mutation against a settled quote.

Source: `islands/PublicQuoteActions.tsx` (copied to `js/PublicQuoteActions.tsx`,
409 lines). Renders three module-local sub-components: `DeclinedCard`,
`DeclineForm`, `AskForm`.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/PublicQuoteActions.tsx`).
- **Interaction tier:** `island` — client state + form-POST mutations via
  `fetch`. NOT a Fresh Partial; NOT a server-rendered form.
- **Client state owned:**
  - `mode: "actions" | "decline" | "ask"` — which panel is showing (default `"actions"`).
  - `resolved: "accepted" | "declined" | null` — terminal latch (default `null`).
  - sub-form local state (`DeclineForm`/`AskForm`): `reason?`, `note`, `name`,
    `question`, `contactBack`, `status: "idle"|"submitting"|"ok"|"error"`, `err?`.
- **Server mutations (action endpoints):**
  - **Decline:** `POST /api/quotes/:id/decline` JSON
    `{ reason?, note?, name? }` (only present keys). Same-origin Fresh `/api`
    proxy → backend (avoids CORS). On success → `onDeclined()` latches
    `resolved="declined"`.
  - **Ask:** `POST /api/quotes/:id/inquiry` JSON `{ question, contactBack?, name? }`.
    On success the `AskForm` shows its own "Question sent" card (no latch — asking
    doesn't settle the quote).
  - **Accept:** delegated — `PublicAcceptQuote` POSTs `/api/quotes/:id/accept`
    (see that component). `onAccepted()` here latches `resolved="accepted"`.
- **Flash / feedback:** inline only. Submit buttons swap label →
  `publicQuoteActions.sending` ("Sending…") and go `disabled`+`opacity:.7`+
  `cursor:not-allowed`. Errors render inline (`publicQuoteActions.sendError`
  prefix + friendly message). No toast, no redirect.
- **Logical-failure handling (subtle):** the decline/accept endpoints return
  **HTTP 200** with `{ok:false, reason:"already_accepted"|"already_declined"}` on
  a logical failure. The island parses the body and re-throws so those are treated
  as errors, then `friendlyError()` maps the reason to a localized sentence —
  **never echoing the raw JSON to the homeowner** (deliberate leak prevention).
- **Liveness:** request-response only. No polling, no websocket, no SSE.
- **Data source:** none of its own — all inputs are **props** from the SSR
  `QuoteCard` (`quoteId`, `contractorFirstName`, `customerName`, `lang`).
- **Honest-empty / settled:** when the parent passes a quote that's already
  accepted/lost it simply does NOT mount this island (gated in `QuoteCard`). The
  island's own terminal states are the success/declined cards.

### Anti-patterns
- **No `location.reload()`** anywhere — good. State transitions are in-memory via
  `useState` + the `resolved` latch. (Contrast: flag if a rebuild reaches for a
  reload to "refresh" after accept/decline — it must not.)
- **Double-submit guard is the `resolved` latch + per-form `submitting` disable**,
  NOT a re-fetch. Preserve it.

### Reactivity / i18n
- `lang` is a **prop** (`"en"|"es"`, default `"en"`), threaded from the SSR
  page's `commsLanguage` resolution. All strings via `tFor(lang,key,vars)`. There
  is no on-page language toggle, so this is NOT reactive to `langSignal`.
- `es` is a local boolean (`lang === "es"`) passed into the sub-forms.

## 2. Anatomy (inline styles captured)
```
<div>                                              ← root (PublicQuoteActions)
  {resolved!=="declined" && <PublicAcceptQuote …/>} ← accept island (always, until declined)
  {resolved==="declined" && <DeclinedCard/>}

  {resolved===null && mode==="actions" &&           ← secondary button row
    <div style="margin-top:14px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button "Ask a question"  style="bg:#fff;border:1px solid #d8e0db;color:#144852;font-weight:700;font-size:13px;padding:10px 18px;border-radius:10px"/>
      <button "Decline"         style="bg:#fff;border:1px solid #d8e0db;color:#6b7a7e;…"/>
    </div>}

  {mode==="decline" && <DeclineForm/>}
  {mode==="ask"     && <AskForm/>}
</div>
```
When `resolved==="accepted"` the whole component short-circuits to a single
`<PublicAcceptQuote … initialAccepted/>` (renders its own success card).

### DeclineForm (inline)
```
<form style="margin-top:18px;background:#fff;border:1px solid #e3e8e6;border-radius:14px;padding:18px 20px;text-align:left">
  <div header row>  "Decline this quote"  + <button × close (aria-label)>
  <div "Quick reason (optional):">
  <div chips row flex-wrap gap:8px>
    reasonChips: Price · Timing · Going elsewhere · Other
      active chip: border #519843; bg rgba(81,152,67,.10); color #144852; weight 800
      idle chip:   border #d8e0db; bg #fff; color #6b7a7e; weight 600
      (radius:999px pill; toggling re-clicks clears it)
  <label "Anything to share? (optional)">  <textarea rows=3>
  <label "Your name (optional)">           <input autoComplete=name>
  {err && <div color:#b3261e>}             ← "Couldn't send — " + friendly msg
  <button submit  style="bg:#a83b3b;color:#fff;weight:800;padding:12px 20px;radius:12px;width:100%"
    label = submitting ? "Sending…" : "Send decline">
</form>
```
### AskForm (inline) — same card chrome; submit button is teal `#144852`
```
<form …same card…>
  header "Ask a question" + close ×
  <label "Your question"> <textarea rows=3 required>
  <label "How can they reach you? (optional)"> <input "Phone or email">
  <label "Your name (optional)"> <input autoComplete=name>
  {err && inline}
  <button submit  bg:#144852  disabled until question non-empty
    label = submitting ? "Sending…" : "Send question">
</form>
```
On success → replaces form with teal-tinted card: ✓ "Question sent" +
"Your contractor will follow up directly."

### DeclinedCard (inline) — shown after a successful decline
```
<div style="margin-top:18px;background:#fdf2f2;border:1px solid #f3d4d4;border-radius:14px;padding:18px 20px;text-align:center">
  <div weight:800 color:#a83b3b font:16px>  "Got it — thanks for letting them know"
  <div color:#6b7a7e font:13px>             "Your contractor has been notified."
</div>
```

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `quoteId` | string (required) | — | text | no |
| `contractorFirstName` | string? | `undefined` | text | no |
| `customerName` | string? | `undefined` (pre-fills decline/ask name) | text | no |
| `lang` | `"en"\|"es"` | `"en"` | select | no |

(All callback-style behaviors — `onAccepted`/`onDeclined`/`onCancel` — are
**internal** wiring between this island and its children, not public props. Drive
them via Events.)

## 4. States → cases
| state | meaning | case |
|---|---|---|
| actions | default — accept form + Ask/Decline button row | `cases/actions/actions.json` |
| decline-form | `mode="decline"` — reason chips + note + name | `cases/decline-form/decline-form.json` |
| declined-card | `resolved="declined"` — success card, no buttons | `cases/declined-card/declined-card.json` |
| ask-form | `mode="ask"` — question + contact + name | `cases/ask-form/ask-form.json` |
| ask-sent | `AskForm status="ok"` — ✓ Question sent card | `cases/ask-sent/ask-sent.json` |
| error | inline send error (e.g. already_accepted) | `cases/error/error.json` |
| es | Spanish strings throughout | `cases/es/es.json` |

## 5. Events (`capture(page)` predicates)
- `e.source==="button.askButton" && e.type==="click"` → `setMode("ask")`.
- `e.source==="button.declineButton" && e.type==="click"` → `setMode("decline")`.
- `e.source==="button.chip" && e.type==="click"` → toggle `reason` (re-click clears).
- `e.source==="form.decline" && e.type==="submit"` → `POST /api/quotes/:id/decline`
  → on ok `onDeclined()` → `resolved="declined"`.
- `e.source==="form.ask" && e.type==="submit"` → `POST /api/quotes/:id/inquiry`
  → on ok AskForm shows sent card.
- `e.source==="button.close" && e.type==="click"` → `onCancel()` → `setMode("actions")`.
- (accept submit lives in PublicAcceptQuote → `onAccepted()` → `resolved="accepted"`.)

## 6. Motion (real CSS only)
- **None declared.** No `@keyframes`, no `transition` properties in source. State
  changes (mode swap, disabled, error appear) are instant. The only visual deltas
  are the inline `opacity` (1→.7) and `cursor` on disabled submit buttons, applied
  synchronously with no transition. Nothing to film; no reduced-motion concern.

## 7. Responsive
- Single column inside the page's 640px cap. The button row is
  `display:flex;flex-wrap:wrap;justify-content:center` so the two secondary
  buttons wrap on narrow screens. Forms are full-width (`width:100%` inputs).
  No own `@media`.

## 8. A11y
- Close buttons carry `aria-label` (`publicQuoteActions.{decline,ask}Form.closeAria`). Good.
- Ask `<textarea>` is `required`; submit stays `disabled` until non-empty.
- **Gaps:** reason chips are `<button type=button>` (focusable — good) but expose
  no `aria-pressed` for their toggled state; the inline error is a plain `<div>`
  with no `role="alert"` / `aria-live` (a screen reader won't announce a send
  failure). Rebuild fix: add `aria-pressed={active}` to chips and
  `role="alert"` to the error div. No focus is moved to the success card on
  resolve (consider focusing it).

## 9. Used on
`/q/:id` only — mounted by the inline `QuoteCard` render function in
`routes/q/[id].tsx`, and only when the quote is not already accepted/lost.
