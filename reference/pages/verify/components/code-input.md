# `CodeInput` — 6-digit OTP input

> ✅ **Build in v1. Required for login.**

## Purpose

Six visually-separate digit slots that together accept the OTP. Auto-advance focus on input, backspace moves to previous slot, paste fills all slots at once. Auto-submit when the 6th digit is entered. Plays a "shake + clear" animation on bad code.

## Recommended structure

The cleanest implementation is **a single `<input>`** styled to look like 6 slots (using a monospace font + tracking + positioning), rather than 6 separate inputs. This avoids focus-management tangles, supports iOS SMS autofill cleanly, and is one element for screen readers. The visual "boxes" are CSS-painted underlines or background pills.

If the team prefers **6 separate inputs**, the prototype-style implementation is documented at the bottom under §"Alternative: six inputs".

## HTML (single-input approach)

```html
<form id="verify-form" novalidate>
  <label for="code" class="sr-only">6-digit verification code</label>
  <input
    id="code"
    name="code"
    type="text"
    inputmode="numeric"
    autocomplete="one-time-code"
    pattern="\d{6}"
    maxlength="6"
    required
    autofocus
    class="code-input"
    aria-describedby="code-hint"
    aria-invalid="false"
  />
  <span id="code-hint" class="sr-only">Enter the 6-digit code we just texted you</span>
</form>
```

## CSS (single-input approach)

```css
.code-input {
  width: 100%;
  max-width: 320px;
  display: block;
  margin: 0 auto 16px;
  padding: 18px 0;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 18px;        /* fakes the slot gaps */
  color: var(--brand-teal);
  background:
    repeating-linear-gradient(  /* paints the 6 underline boxes */
      to right,
      transparent 0,
      transparent 36px,
      var(--border-strong) 36px,
      var(--border-strong) 38px,
      transparent 38px,
      transparent 50px
    );
  background-position: bottom;
  background-repeat: no-repeat;
  background-size: 100% 2px;
  border: 0;
  outline: 0;
  caret-color: var(--brand-pink);
  text-indent: 9px;            /* center digits over the underlines */
}
.code-input:focus           { background-image: none;
                               border-bottom: 2px solid var(--brand-green);
                               box-shadow: 0 4px 12px -6px rgba(81,152,67,0.3); }
.code-input.is-error        { color: var(--pink-700);
                               animation: shake 360ms cubic-bezier(0.36, 0.07, 0.19, 0.97); }

@keyframes shake {
  10%, 90%  { transform: translateX(-1px); }
  20%, 80%  { transform: translateX( 2px); }
  30%, 50%, 70% { transform: translateX(-4px); }
  40%, 60%  { transform: translateX( 4px); }
}
```

The repeating-gradient draws six underlines spaced to match the letter-spacing; `text-indent` nudges each digit to center over its underline. Tested in Chrome / Safari / Firefox.

## Preact / Fresh translation

```tsx
// v2/frontend/islands/CodeInput.tsx — island

import { useEffect, useRef, useState } from "preact/hooks";
import { langSignal } from "../lib/lang-signal.ts";

export function CodeInput(props: { phoneNumber: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (code.length === 6 && !submitting) verify();
  }, [code]);

  // Cooldown ticker for the Resend button
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => c - 1), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  function onInput(e: Event) {
    const v = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
    setCode(v);
    setError(null);
  }

  async function verify() {
    setSubmitting(true);
    const res  = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: props.phoneNumber, code }),
    });
    const body = await res.json();
    if (body.ok) {
      // Cookie set by the server; just navigate.
      location.href = body.redirectTo ?? '/dashboard';
      return;
    }
    setError(body.error === 'expired'      ? 'verify.errExpired'
           : body.error === 'rate_limited' ? 'verify.errRate'
           :                                 'verify.errInvalid');
    setCode('');
    setSubmitting(false);
    input.current?.focus();
  }

  async function resend() {
    setError(null);
    setCooldown(30);
    await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: props.phoneNumber,
        language:    langSignal.value,    // keep OTP record's language consistent w/ landing toggle
      }),
    });
  }

  return (
    <>
      <label for="code" class="sr-only">6-digit verification code</label>
      <input
        ref={input}
        id="code" name="code" type="text"
        inputmode="numeric" autocomplete="one-time-code"
        pattern="\d{6}" maxLength={6} required autoFocus
        class={`code-input ${error ? 'is-error' : ''}`}
        value={code}
        onInput={onInput}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby="code-hint"
        disabled={submitting}
      />
      {error && <p class="error" role="alert">{/* lookup error key in i18n */}</p>}
      <button type="button"
              class="btn btn-primary btn-lg"
              disabled={code.length < 6 || submitting}
              onClick={verify}>
        {submitting ? 'Verifying…' : 'Verify'}
      </button>
      <div class="meta">
        <a href={`/?prefill=${encodeURIComponent(props.phoneNumber)}`}>Wrong number? Edit</a>
        <button type="button" disabled={cooldown > 0} onClick={resend}>
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </button>
      </div>
    </>
  );
}
```

## Props

```ts
type CodeInputProps = { phoneNumber: string };
```

## Data source

- `POST /api/auth/verify` — Fresh proxy → backend `POST /auth/verify-otp`
- `POST /api/auth/send-otp` — Fresh proxy → backend `POST /auth/send-otp`

The Fresh proxy at `routes/api/auth/verify.ts` forwards the body, then on success: `headers.set('Set-Cookie', `x-session-id=${sessionId}; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000; Path=/`)` and returns `{ ok: true, redirectTo: '/dashboard' }`.

## Island vs server

**Island.** State + DOM + fetch.

## Accessibility

- `inputmode="numeric"` — numeric keypad on mobile.
- `autocomplete="one-time-code"` — iOS suggests the code from SMS above the keyboard.
- `pattern="\d{6}"` — native validation.
- `aria-describedby="code-hint"` points at a sr-only span explaining what to enter.
- `aria-invalid="true"` on error — SR announces the input is invalid.
- The `<p class="error" role="alert">` auto-announces errors when they appear.
- `autoFocus` is acceptable here because this is the page's primary action.
- Honor `prefers-reduced-motion` — skip the shake animation.

## Edge cases

- **Paste a 6-digit code:** input fires once with all 6 digits; auto-submit triggers.
- **Paste with non-digits:** `replace(/\D/g, '')` strips them; truncates to 6.
- **Submit while submitting:** `disabled={submitting}` blocks; `useEffect` early-returns.
- **iOS SMS autofill chip:** tapping it fills the input → auto-submit.
- **User edits after auto-submit fails:** the `onInput` clears `error` so the message goes away.
- **Network failure:** fetch throws → wrap in try/catch, show "Network error — check your connection" and re-enable Verify.
- **Cooldown across page reloads:** not persisted (intentional — the backend rate-limits independently).

## Alternative: six separate inputs

If the team prefers per-slot inputs (Square / Stripe / Discord style):

```jsx
const [digits, setDigits] = useState(Array(6).fill(''));
const refs = Array.from({length: 6}, () => useRef(null));

return (
  <div class="code-grid" role="group" aria-label="6-digit code">
    {digits.map((d, i) => (
      <input
        ref={refs[i]} key={i}
        type="text" inputmode="numeric" maxLength={1}
        autocomplete={i === 0 ? 'one-time-code' : 'off'}
        value={d}
        onInput={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 1);
          const next = [...digits]; next[i] = v;
          setDigits(next);
          if (v && i < 5) refs[i+1].current.focus();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Backspace' && !digits[i] && i > 0) refs[i-1].current.focus();
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
          if (text.length === 6) {
            setDigits(text.split(''));
            refs[5].current.focus();
            e.preventDefault();
          }
        }}
        class="code-slot"
      />
    ))}
  </div>
);
```

CSS for the grid:

```css
.code-grid {
  display: grid; grid-template-columns: repeat(6, 1fr);
  gap: 8px; max-width: 320px; margin: 0 auto 16px;
}
.code-slot {
  aspect-ratio: 1; width: 100%;
  text-align: center;
  font-family: var(--font-mono); font-size: 24px; font-weight: 700;
  color: var(--brand-teal);
  background: var(--mint-100);
  border: 2px solid var(--border-strong);
  border-radius: 12px;
  outline: 0;
}
.code-slot:focus           { border-color: var(--brand-green);
                              box-shadow: 0 0 0 4px rgba(81,152,67,0.18); }
```

Trade-off: per-slot inputs look more polished but `autocomplete="one-time-code"` only works on the first one — iOS fills only that slot, and you have to manually distribute. The single-input approach gets autofill for free.

**Recommendation: ship the single-input version first.** Re-evaluate after launch if user feedback warrants the per-slot polish.
