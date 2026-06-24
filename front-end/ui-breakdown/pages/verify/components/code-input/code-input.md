# CodeInput

The 6-digit OTP entry on `/verify`. Six single-char boxes, paste/autofill aware,
auto-submits when full, POSTs to verify, animates the SSR step-indicator to
"You're in", then navigates to the dashboard (or onboarding for new users).

## 1. Classification & behavior
- **Bucket:** `island` (`islands/CodeInput.tsx`).
- **Interaction tier:** `island` (client-only state) performing a **server
  mutation via fetch + manual navigation** + **direct DOM mutation of the
  SSR-rendered `.pm-steps` indicator** (it reaches outside its own tree by id).
- **Client state owned (`useState`/`useRef`):**
  - `refs: (HTMLInputElement|null)[]` — the six slot inputs (callback-ref array).
  - `digits: string[6]` — the entered characters.
  - `submitting: boolean` — disables CTA, swaps label to `verify.busy`.
  - `errorKey: "verify.errInvalid"|"verify.errExpired"|"verify.errRate"|null`.
  - `shake: boolean` — toggles `.shake` on `.code-input` for 380ms on failure.
  - `cooldown: number` — resend countdown seconds (ticks via `setTimeout`,
    decrement loop in an effect — see Liveness).
  - `force` — a counter bumped on `langSignal` change to re-render.
- **Props:** `phoneNumber` (E.164, from `?phone=`), `initialLang` (SSR-resolved).
- **Mount effect:** reads `localStorage["pm:lang"]` → sets `langSignal` to it ??
  `initialLang` ?? `"en"`; focuses slot 0; subscribes to `langSignal`.
- **Server mutation + feedback:**
  - `submit(code?)` (auto-fires when 6th digit lands, on full paste/autofill, or
    via the CTA) → `verifyClient.verifyOtp({ phoneNumber, code })` →
    **POST `/api/auth/verify-otp`**.
    - **Success (`result.ok`):** persist `localStorage["pm:last-phone"]`; then
      **mutate the SSR `.pm-steps` DOM directly** — flip `#pm-step-code` from
      `--active`→`--done` (dot "✓"), add `--done` to `#pm-step-bar-2`, set
      `#pm-step-in` `--active` (dot "✓"); after a **400ms** delay
      `location.href = result.redirectTo` (`/dashboard?welcome=back` or
      `/assistant?onboard=1` for new users — decided in `clients/verify.ts`).
    - **Failure:** map backend error → `errorKey`; set `shake` true for 380ms;
      clear all digits; refocus slot 0.
  - `resend()` → guarded by `cooldown>0` → set `cooldown=30` → POST
    `/api/auth/send-otp` (via `verifyClient.resendOtp`). Errors are swallowed
    ("keep cooldown").
- **Liveness:** request-response (verify + resend POSTs). PLUS a **client
  countdown timer**: a `useEffect` on `cooldown` schedules a 1s `setTimeout`
  that decrements until 0 — a self-driven tick, not pushed from a server. No
  websocket, no polling of server state.
- **ANTI-PATTERN flagged (cross-tree DOM mutation):** the success path imperatively
  edits SSR-rendered nodes by `document.getElementById("pm-step-code"/"pm-step-in"/
  "pm-step-bar-2")` and rewrites `.pm-steps__dot` textContent. The step indicator
  is owned by the route (`verify.tsx`), not the island, so this is an island
  reaching across the boundary — fragile if the markup ids change. **Fix:** lift
  the step state into the island (render the `.pm-steps` from CodeInput, or share
  a signal) so the "You're in" transition is declarative, not `getElementById`
  surgery. NOTE: this is NOT the `location.reload()` anti-pattern — it's a forward
  `location.href` navigation, which is correct for a post-auth redirect.
- **DEAD sibling (do not wire):** `static/verify-scripts.js` is a complete
  plain-JS port of this island (posts to `/api/auth/verify-otp`, same shake/
  resend logic). It is **referenced by nothing** (grep: zero `<script
  src="/verify-scripts.js">`); `verify.tsx` mounts the island instead. Confirmed
  dead code — see verify.md.
- **Data-shape hazards:**
  - `setSlot` handles three input shapes: single char (normal typing),
    multi-char (iOS SMS autofill / Android one-time-code / paste that bypasses
    the paste handler — spreads across slots from index `i`), and the dedicated
    `onPaste` handler (spreads a clipboard string). All three converge on
    auto-submit when slot 6 fills.
    - **Latent bug:** in the single-char branch, auto-submit at the last slot
      builds the code as `[...digits.slice(0, i), v].join("")` — `digits` is the
      *previous* render's state (stale closure), and it drops slots `i+1..5`.
      For sequential entry slots 0–4 are already set so this is fine; but it's a
      stale-state pattern worth noting.
  - `verifyClient.verifyOtp` translates raw backend responses into a discriminated
    union; unknown errors collapse to `invalid_code`.

## 2. Anatomy
```
<>
  <div class="code-input [shake]" onPaste=onPaste>
    digits.map(i => <input ref type=text inputMode=numeric
        autoComplete=one-time-code value={d}
        onInput=setSlot onKeyDown=onKeyDown(Backspace→prev)
        aria-label={t("verify.digitLabel",{n:i+1})} />)   ← ×6
  </div>
  {errorKey && <p class="error" role="alert">{s[errorKey]}</p>}
  <button class="btn btn-primary btn-lg" type=button
          disabled={submitting || code.length!==6} onClick={submit}>
    {submitting ? t("verify.busy") : s["verify.cta"]}      ← "Verify"
  </button>
  <div class="meta">
    <a href="/">{s["verify.editPhone"]}</a>                ← "Wrong number? Edit"
    <button onClick=resend disabled={cooldown>0}>
      {cooldown>0 ? "Resend in {n}s" : "Resend code"}
    </button>
  </div>
</>
```
Mounted inside the route's `.verify-card`, below the `.pm-steps` indicator,
`<h1>` ("Check your phone") and the lede with the masked phone.
- **Slots/children:** none.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `phoneNumber` | string (E.164) | — (required) | text | no |
| `initialLang` | `"en"\|"es"` | `undefined` → `"en"` | select | seeds langSignal |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| default | empty slots, slot 0 focused, CTA disabled | `cases/default/default.json` |
| filled | all 6 digits entered, CTA enabled | `cases/filled/filled.json` |
| submitting | verify POST in flight, CTA shows busy | `cases/submitting/submitting.json` |
| error | wrong code → `.error` + `.shake`, digits cleared | `cases/error/error.json` |
| resend-cooldown | resend disabled, "Resend in 27s" | `cases/resend-cooldown/resend-cooldown.json` |
| es | Spanish strings (`langSignal="es"`) | `cases/es/es.json` |

## 5. Events
- `ev.expect(e => e.source==="input" && e.type==="input")` → `setSlot(i,val)`:
  single→fill+advance; multi→spread+autosubmit when full.
- `ev.expect(e => e.source==="input" && e.type==="keydown" && e.key==="Backspace")`
  → if empty, focus previous slot.
- `ev.expect(e => e.source==="div.code-input" && e.type==="paste")` → `onPaste`:
  spread clipboard digits, autosubmit if 6.
- `ev.expect(e => e.source==="button.btn-primary" && e.type==="click")` →
  `submit()` → POST `/api/auth/verify-otp`.
- `ev.expect(e => e.source==="div.meta button" && e.type==="click")` →
  `resend()` → POST `/api/auth/send-otp`, start 30s cooldown.
- `ev.expect(e => e.source==="div.meta a" && e.type==="click")` → nav `/` (edit phone).
- External (received): `langSignal` change → `force` re-render (new `s` strings).

## 6. Motion (extracted)
- **Shake — `@keyframes shake`** 360ms ease (added to `.code-input` for 380ms on
  a failed verify, then removed): `0/100%{0} 20%{-8px} 40%{8px} 60%{-6px}
  80%{6px}` on `translateX`.
- **Input focus:** `transition: border-color 140ms, box-shadow 140ms`; focus =
  green outline + `0 0 0 4px rgba(81,152,67,.20)` glow.
- **CTA:** `.btn transition: transform 120ms, background 200ms, color 200ms`;
  `:active` nudges `translateY(1px)`.
- **Success step transition:** the `.pm-steps__dot` transitions
  `background/color/box-shadow 280ms`; the newly-active "You're in" dot picks up
  `pm-steps-pulse` (1.6s box-shadow halo). The island's 400ms pre-nav delay
  exists to let this play. **Jank finding:** the 400ms hard timeout races the
  navigation — on a slow redirect the pulse barely starts; fine, but the magic
  number couples animation timing to navigation. Fix: drive nav off the
  transition/animation end event, or keep the indicator inside the island.
- **Reduced motion:** verify.css disables the active-dot pulse
  (`@media (prefers-reduced-motion: reduce){.pm-steps__item--active .pm-steps__dot
  {animation:none}}`); the global token clamp flattens shake + .btn transitions.

## 7. Responsive (this component's own widths)
- **No `@media` of its own.** Six 44×56px boxes with 8px gaps = ~328px, which
  fits the `.verify-card` (max 440px, 32px padding → ~376px content) at every
  width down to ~360px. On a 320px viewport the row can overflow the card
  padding — verify.css does not narrow the slots, so confirm at 320px.
- The shell (`.verify-shell`) re-centers above the soft keyboard via `--vvh`/
  `--vvt` from the MobileViewport island.

## 8. A11y
- Each slot is a real `<input inputMode="numeric" autoComplete="one-time-code">`
  with a unique `aria-label` ("Digit 1".."Digit 6") — supports iOS/Android OTP
  autofill. Error is `<p role="alert">`. CTA + resend are real `<button>`;
  edit-phone is a real `<a href="/">`.
- **Gaps:** no `aria-live` region narrates the auto-advance; the cross-tree
  step-indicator update isn't announced; focus management on error (refocus slot
  0) is good but not announced. Master dev OTP `000000` always verifies in dev.

## 9. Used on
- **`/verify`** only (`routes/verify.tsx` line 85). Page-local island.
- Superseded `static/verify-scripts.js` (dead). Pairs with the SSR `.pm-steps`
  indicator that `verify.tsx` renders and this island mutates on success.
