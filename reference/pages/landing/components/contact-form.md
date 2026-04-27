# `ContactForm` — Login (OTP request) with live SMS preview

> ✅ **Build in v1. This IS the login form.** The phone-input is the OTP-request input; on submit, the page navigates to `/verify?phone=…` for the 6-digit code entry. See `pages/verify/root.md` and `backend.md` §2.A.
>
> The prototype's "5-second simulated reply" + "typing indicator from Marisol" + "auto-reset after 11s" was a marketing demo — **discard that simulation**. Production behavior is: submit → `POST /api/auth/send-otp` → on success, route to `/verify`.

## Purpose

Two-column dark teal card. Left: copy with three reassurances ("No setup fees", "First quote free", "English & Spanish"). Right: a faux SMS-thread mockup that doubles as the login form. The user types a phone number; the input formats live as `(###) ###-####`, and the bubble at the bottom of the SMS thread updates in real time to show what their first text would say. On submit, fire `POST /api/auth/send-otp`, then route to `/verify?phone=<encoded>`.

## Source

- HTML: `Paperwork Monsters Landing.html` lines **2380–2459**
- CSS: `styles.css` lines **1050–1141** (`.contact`, `.contact-bg`, `.contact-card`, `.contact-info`, `.contact-form`) — note the prototype's `.contact-form` rules apply to the bare-form variant; the SMS-styled variant uses `.cf-*` classes defined inline in `Landing.html`'s `<style>` block (lines 264–1745)
- JS: `Paperwork Monsters Landing.html` lines **464–545**

## Screenshots

The bundle's `screenshots/check.png`, `check4-8.png` show successful-submit confirmation states.

![Submit confirmation](../../../paperwork-monsters/project/screenshots/check.png)

## HTML (verbatim)

```html
<section class="contact" id="contact">
  <div class="container">
    <div class="contact-card">

      <div class="contact-info">
        <span class="eyebrow-pill" data-i18n="cta.eyebrow">Let's go</span>
        <h2 data-i18n="cta.h2">Ready to get the paperwork off your plate?</h2>
        <p data-i18n="cta.lead">Drop your number. We'll text you within the hour and walk you through your first quote — free.</p>
        <ul class="checks">
          <li><svg /* check */></svg> <span data-i18n="cta.b1">No setup fees, no contracts</span></li>
          <li><svg /* check */></svg> <span data-i18n="cta.b2">First quote free, on us</span></li>
          <li><svg /* check */></svg> <span data-i18n="cta.b3">English & Spanish, every step</span></li>
        </ul>
      </div>

      <form class="contact-form" id="contact-form">
        <!-- phone-style SMS preview -->
        <div class="cf-phone">
          <div class="cf-phone__hdr">
            <span class="cf-phone__avatar">PM</span>
            <span class="cf-phone__name">
              <strong>Paperwork Monsters</strong>
              <em>Online <span class="cf-phone__live"></span></em>
            </span>
            <span class="cf-phone__call" aria-hidden="true">
              <svg /* call */></svg>
            </span>
          </div>

          <div class="cf-phone__body" id="cf-phone-body">
            <div class="cf-bubble cf-bubble--them">
              <span>👋 Hey! I'm <strong>Marisol</strong> from Paperwork Monsters.</span>
            </div>
            <div class="cf-bubble cf-bubble--them">
              <span>Drop your number below and I'll text you within the hour to walk you through your <strong>first quote — free</strong>.</span>
            </div>
            <div class="cf-bubble cf-bubble--me cf-bubble--preview" id="cf-bubble-preview">
              <span id="cf-preview-text">Hi Paperwork Monsters!</span>
            </div>
            <div class="cf-meta" id="cf-meta">
              <span class="cf-meta__check">
                <svg width="9" height="9" /* check 1 */></svg>
                <svg width="9" height="9" style="margin-left:-5px" /* check 2 */></svg>
              </span>
              <span>Delivered · Replies in <strong>~5 sec</strong></span>
            </div>
          </div>

          <div class="cf-phone__compose">
            <span class="cf-phone__plus" aria-hidden="true">+</span>
            <label for="f-phone" class="cf-phone__field">
              <input id="f-phone" name="phone" type="tel"
                     placeholder="Tap to enter your number"
                     required autocomplete="tel" inputmode="tel"/>
            </label>
            <button class="cf-phone__send" type="submit" aria-label="Send">
              <svg /* paper-plane */></svg>
            </button>
          </div>
        </div>

        <button class="cf-cta submit" type="submit">
          <span data-i18n="cta.btn">Text me my first quote</span>
          <svg /* arrow → */></svg>
        </button>

        <div class="cf-trust">
          <div class="cf-trust__avatars">
            <span class="cf-trust__av" style="background:var(--brand-pink)">JG</span>
            <span class="cf-trust__av" style="background:var(--brand-teal)">CL</span>
            <span class="cf-trust__av" style="background:var(--coffee-500)">TS</span>
          </div>
          <div class="cf-trust__text"><strong>34 contractors</strong> signed up this week</div>
        </div>

        <div class="fine" data-i18n="cta.fine">By submitting, you agree to receive a friendly text from us.</div>
      </form>
    </div>
  </div>
</section>
```

## CSS — outer card (`styles.css:1050–1101`)

```css
.contact { padding: 110px 0; position: relative; overflow: hidden; }
.contact-bg {
  position: absolute; inset: 0;
  background: var(--brand-teal);
  border-radius: var(--radius-2xl);
  margin: 0 24px;
}
.contact .container { position: relative; }

.contact-card {
  background: var(--brand-teal);
  border-radius: var(--radius-2xl);
  padding: 64px;
  position: relative; overflow: hidden;
  display: grid; grid-template-columns: 1.1fr 1fr;
  gap: 56px; align-items: center;
}
/* halo blobs (top-right pink, bottom-left green) */
.contact-card::before {
  content: ''; position: absolute; top: -100px; right: -100px;
  width: 360px; height: 360px;
  background: radial-gradient(circle, rgba(255,107,107,0.25) 0%, transparent 70%);
}
.contact-card::after {
  content: ''; position: absolute; bottom: -120px; left: -80px;
  width: 320px; height: 320px;
  background: radial-gradient(circle, rgba(81,152,67,0.25) 0%, transparent 70%);
}

.contact-info { position: relative; z-index: 1; color: #fff; }
.contact-info .eyebrow-pill { background: rgba(255,255,255,0.12); color: #fff; }
.contact-info h2 {
  font-family: var(--font-heading); font-weight: 800;
  font-size: clamp(34px, 4vw, 48px); line-height: 1.05;
  letter-spacing: -0.025em;
  margin: 18px 0 16px;
  color: #fff;
}
.contact-info p { font-size: 17px; line-height: 1.55;
                  color: rgba(255,255,255,0.75); margin: 0 0 24px; }
.contact-info .checks    { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
.contact-info .checks li { display: flex; align-items: center; gap: 10px; font-size: 15px;
                            color: rgba(255,255,255,0.9); font-weight: 500; }
.contact-info .checks svg { color: var(--brand-green); flex-shrink: 0; }
```

The `.cf-*` SMS-bubble styles are defined inline in `Landing.html` lines 264–1745 and not extracted into `styles.css`. **Use the inline rules as the source of truth** — they're scoped to the SMS-styled form variant. The bare-form fallback `.contact-form input { … }` rules in `styles.css:1117–1141` are not used by the v5 prototype.

## JS (verbatim)

```js
(function contactForm(){
  const form         = document.getElementById('contact-form');
  const phoneInput   = document.getElementById('f-phone');
  const preview      = document.getElementById('cf-bubble-preview');
  const previewText  = document.getElementById('cf-preview-text');
  const meta         = document.getElementById('cf-meta');
  const body         = document.getElementById('cf-phone-body');
  if (!form || !phoneInput || !preview) return;

  function formatPhone(v) {
    const d = v.replace(/\D/g, '').slice(0, 10);
    if (!d) return '';
    if (d.length < 4) return '(' + d;
    if (d.length < 7) return '(' + d.slice(0,3) + ') ' + d.slice(3);
    return '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6);
  }

  phoneInput.addEventListener('input', () => {
    phoneInput.value = formatPhone(phoneInput.value);
    const v = phoneInput.value.trim();
    if (v) {
      previewText.innerHTML = 'Hi! It’s ' + v + ' — send me my first quote please';
      preview.classList.add('is-real');
      meta.classList.add('is-real');
    } else {
      previewText.innerHTML = 'Hi Paperwork Monsters!';
      preview.classList.remove('is-real');
      meta.classList.remove('is-real');
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('.cf-cta');
    if (!btn) return;
    const original = btn.innerHTML;
    const okText = curLang === 'es'
      ? '<span>✓ Listo — te escribimos pronto</span>'
      : '<span>✓ Got it — we’ll text you soon</span>';

    // 1) Lock the preview bubble + meta in
    preview.classList.add('is-real');
    meta.classList.add('is-real');

    // 2) Add typing indicator from "them"
    const typing = document.createElement('div');
    typing.className = 'cf-bubble cf-bubble--them cf-bubble--typing';
    typing.innerHTML = '<span class="cf-typing"><i></i><i></i><i></i></span>';
    body.insertBefore(typing, meta);

    // 3) After 5s, replace typing with the reply (~5s feels like a real human)
    setTimeout(() => {
      typing.outerHTML = '<div class="cf-bubble cf-bubble--them cf-bubble--reply"><span>👋 Got it! Texting you in <strong>under an hour</strong>. Talk soon — <strong>Marisol</strong></span></div>';
    }, 5000);

    // 4) Update CTA
    btn.innerHTML = okText;
    btn.style.background = 'var(--brand-green)';
    btn.style.boxShadow  = '0 14px 30px -6px rgba(81,152,67,0.45)';

    // 5) After 11s total, restore everything
    setTimeout(() => {
      btn.innerHTML = original;
      btn.style.background = '';
      btn.style.boxShadow  = '';
      const reply = body.querySelector('.cf-bubble--reply');
      if (reply) reply.remove();
      preview.classList.remove('is-real');
      meta.classList.remove('is-real');
      previewText.innerHTML = 'Hi Paperwork Monsters!';
      form.reset();
    }, 11000);
  });
})();
```

## Preact / Fresh translation

```tsx
// v2/frontend/islands/ContactForm.tsx — island (input formatter + simulated send)
import { useState, useRef } from "preact/hooks";
import { langSignal } from "../lib/lang-signal.ts";

function formatPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 10);
  if (!d) return '';
  if (d.length < 4) return '(' + d;
  if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
  return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
}

export function ContactForm() {
  const lang = langSignal.value;
  const [phone, setPhone]       = useState('');
  const [submitState, setState] = useState<'idle'|'submitting'|'replied'>('idle');
  const previewBody = useRef<HTMLDivElement>(null);

  const previewText = phone
    ? `Hi! It's ${phone} — send me my first quote please`
    : 'Hi Paperwork Monsters!';
  const isReal = phone.length > 0 || submitState !== 'idle';

  async function submit(e: Event) {
    e.preventDefault();
    if (!phone) return;
    setState('submitting');
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phone,
          language:    lang,        // 'en' | 'es' from langSignal — captured at signup, seeds User.language
        }),
      });
      const body = await res.json();
      if (!body.sent) throw new Error(body.error ?? 'send_failed');
      // Route to the verify-code page with the phone in the URL.
      location.href = `/verify?phone=${encodeURIComponent(phone)}`;
    } catch (err) {
      setState('idle');
      // Show a small error pill near the form; reuse the same design as /verify errors.
    }
  }

  return (
    <form onSubmit={submit} class="contact-form">
      <div class="cf-phone">
        {/* …header / live dot / call icon… */}
        <div ref={previewBody} class="cf-phone__body">
          {/* two static them-bubbles… */}
          <div class={`cf-bubble cf-bubble--me cf-bubble--preview ${isReal ? 'is-real' : ''}`}>
            <span>{previewText}</span>
          </div>
          <div class={`cf-meta ${isReal ? 'is-real' : ''}`}>
            <span class="cf-meta__check">{/* twin check svgs */}</span>
            <span>Delivered · Replies in <strong>~5 sec</strong></span>
          </div>
          {submitState === 'submitting' && (
            <div class="cf-bubble cf-bubble--them cf-bubble--typing">
              <span class="cf-typing"><i/><i/><i/></span>
            </div>
          )}
          {submitState === 'replied' && (
            <div class="cf-bubble cf-bubble--them cf-bubble--reply">
              <span>👋 Got it! Texting you in <strong>under an hour</strong>. Talk soon — <strong>Marisol</strong></span>
            </div>
          )}
        </div>
        <div class="cf-phone__compose">
          <span class="cf-phone__plus" aria-hidden="true">+</span>
          <label for="f-phone" class="cf-phone__field">
            <input id="f-phone" name="phone" type="tel"
                   value={phone} onInput={e => setPhone(formatPhone((e.target as HTMLInputElement).value))}
                   placeholder="Tap to enter your number"
                   required autocomplete="tel" inputmode="tel" />
          </label>
          <button class="cf-phone__send" type="submit" aria-label="Send">{/* paper-plane */}</button>
        </div>
      </div>

      <button type="submit"
              class={`cf-cta submit ${submitState !== 'idle' ? 'submitted' : ''}`}>
        <span>
          { submitState === 'idle'
              ? (lang === 'es' ? 'Mándame mi primera cotización' : 'Text me my first quote')
              : (lang === 'es' ? '✓ Listo — te escribimos pronto' : "✓ Got it — we'll text you soon") }
        </span>
        {/* arrow → */}
      </button>

      <div class="cf-trust">{/* …avatars + 34 contractors text… */}</div>

      <div class="fine">{lang === 'es'
          ? 'Al enviar, aceptas recibir un mensaje amigable de nuestra parte.'
          : 'By submitting, you agree to receive a friendly text from us.'}</div>
    </form>
  );
}
```

## Props

```ts
type ContactFormProps = {};
```

## Data source

**`POST /api/auth/send-otp`** (Fresh proxy → backend `POST /auth/send-otp`). Body includes `{ phoneNumber, language }` — `language` is `langSignal.value` (`'en'` or `'es'`), captured at signup and seeded into `User.language` on the very first verify-otp success (see `backend.md` §3.A "First-time signup language capture"). It also localizes the outgoing SMS body. On success, route to `/verify?phone=<encoded>` to enter the 6-digit code. See `backend.md` §2.A for the endpoint surface and `pages/verify/root.md` for the next page.

The "Marisol" simulation in the prototype (5 s typing → reply → 11 s reset) was a **marketing visual**, not a real flow. Drop it: the chat-bubble preview can stay as a static "what your first text will look like" hint, but no fake reply.

## Island vs server

**Island.** Input formatting + state machine for submit are interactive.

## Accessibility

- The `<input>` is properly labeled via `<label for="f-phone">` (visually hidden by being inside `.cf-phone__field`).
- `inputmode="tel"` + `autocomplete="tel"` enable the right keyboard on iOS/Android.
- `placeholder` is not a label — keep the explicit `<label>`.
- The "Marisol" reply bubble appears via DOM mutation 5s after submit. Add `role="status"` + `aria-live="polite"` on its container so SR announces it.
- The CTA button's text changes during submit. With `aria-live="polite"` on the button label span, SR will announce the change.
- The decorative call icon needs `aria-hidden="true"` (already in HTML).
- `+` plus icon is decorative.

## Edge cases

- **Submit before phone entry:** the form has `required` on the input + a `pattern` is implicit via `formatPhone`. Browser-level validation kicks in.
- **Lang switch mid-submit:** the timers continue; copy updates on the button via the signal. Acceptable.
- **Reset after 11s:** clears phone, removes reply bubble, restores CTA. Make sure to also `clearTimeout` if the user navigates away mid-cycle.
- **Pasted formatted number:** `replace(/\D/g, '')` strips everything but digits, so `(512) 555-1234` → `5125551234` → reformatted. ✓
- **More than 10 digits:** sliced to 10. International numbers not supported (US/CA only).
- **Submit twice:** disable the button while `submitState !== 'idle'`.
- **Submit without JS:** the form has `action=""` (none), so it would post to itself with empty result. Add `action="/api/leads"` so non-JS submissions still capture the lead.
