# Page: `/verify`

**Route:** `routes/verify.tsx` · **Source copied to:** `js/verify.tsx`, plus
island in `components/code-input/`.

## Purpose
Step 2 of auth: enter the 6-digit OTP texted to the phone from `/login`. Dev
master OTP is **`000000`**.

## Classification & data flow
- **Page tier:** **static SSR** + one island.
- **Required query (server):** reads `?phone=…`; **if absent → 302 → `/`**
  (can't verify without a target number).
- **Auth guard (server):** `loadUser` → if authenticated, **302 → `/dashboard`**.
- **Language (server):** `langFromCookie` ?? `pickLangFromAcceptLanguage`;
  uses `STRINGS[lang]` directly (the `s[...]` lookups) plus `tFor`.
- **Phone masking (server):** `formatPhoneDisplay(e164)` → `(xxx) xxx-xxxx`
  for the "code sent to …" line.
- **Island:** `<CodeInput phoneNumber={phone} initialLang={lang} />` owns the
  digit boxes, paste/auto-advance, the verify POST, error state, and the
  redirect on success.

## `<Head>`
- `<title>{verify.h1} · {brand.name}</title>`
- `<link rel="stylesheet" href="/verify.css">` (shared with `/login`).

## Layout / composition order
```
.verify-shell
  .verify-card
    a.brand → href="/"                       (logo-monster.png + wordmark)
    ol.pm-steps  (aria verify.steps.aria)     ← 3-step progress indicator
      li.pm-steps__item--done   ✓  phone
      span.pm-steps__bar--done
      li.pm-steps__item--active 2  code   (#pm-step-code)
      span.pm-steps__bar (#pm-step-bar-2)
      li.pm-steps__item         3  in     (#pm-step-in)
    h1   verify.h1                            (32px)
    p.muted   verify.lede + <strong>{masked phone}</strong>
    <CodeInput phoneNumber initialLang />     ← ISLAND
```
The `#pm-step-*` ids are advanced by the island as the user progresses
(code accepted → step 3 lights up). Verify whether `static/verify-scripts.js`
participates (the page does not `<script>` it directly; the island drives it).

## Components on this page
| Component | Where | Tier |
|---|---|---|
| `code-input` (`CodeInput`) | `pages/verify/components/code-input/` | island — OTP entry, auto-advance/paste, verify POST, success redirect |

## Capture checklist (auth-free → capture-ready)
- URL: `/verify?phone=%2B15551234567` (logged-out; needs the `phone` param or it
  redirects to `/`). Logged-in 302s to dashboard.
- Viewports: 390, 768, 1280 (single-column card; check `verify.css` `@media`).
- States: empty, partially typed, full + verifying, invalid-code error, the
  3-step progress at step 2 vs step 3. Master OTP `000000` advances it.

## Build order
design tokens → `verify.css` shell + `.pm-steps` → `code-input` island → this page.
