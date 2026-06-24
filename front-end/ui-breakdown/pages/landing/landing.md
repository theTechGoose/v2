# Page — landing (`/`)

Marketing home. A long, fully STATIC server-rendered marketing page whose only
hydrated component is the **PhoneChat** island (demo section). All other
interactivity — language toggle, hero word rotor, marquee, doc-tab cycling,
animated count-up, smooth-scroll, the contact/OTP form — is driven by a single
vanilla-JS file loaded with a `<script defer>`, NOT by island hydration.

Source: `routes/index.tsx` (1131 lines). Behavior: `static/landing-scripts.js`
(697 lines, plain IIFE). Styling: `static/landing.css` (3124 lines). Copies are
in `js/index.tsx`, `js/landing-scripts.js`, `css/landing.css`.

## Classification
- **Bucket:** `page-composition` — almost entirely `static` SSR markup with
  `data-i18n` / `data-en` / `data-es` / `data-html` / `data-doc` / `data-lang`
  hooks the vanilla JS reads. One mounted island (PhoneChat).
- **Why vanilla JS, not an island:** the file's own header explains Fresh island
  hydration was broken for "post-effect" islands (module-URL CORS), so the
  behavior was ported to `static/landing-scripts.js` and loaded via
  `<script src="/landing-scripts.js" defer>`. Memory confirms this. The would-be
  island `islands/LandingScripts.tsx` is therefore **dead** (see Dead code).

## SSR handler / data fetched
- `define.page(async function Landing(ctx))`. Calls `await loadUser(ctx.req)`;
  **if a user is logged in → 302 to `/dashboard`** (landing is logged-out only).
- No other server fetch. All copy is literal English in the JSX (the EN default),
  swapped to ES client-side by `landing-scripts.js`'s inline `I18N` dict.
- The route uses `tFor("en", …)` only for the `<title>` + meta description.

## `<Head>`
- `<title>` = `tFor("en","landing.head.title")` = "Paperwork Monster — You do
  the work. We handle the paperwork."
- `<meta name="description">` = `landing.head.metaDescription`.
- `<link rel="stylesheet" href="/landing.css">`.
- `<script src="/landing-scripts.js" defer>` — the behavior layer.

## App-shell composition / islands mounted (in DOM order)
1. **PhoneChat** island — the only hydrated component, in the `.demo` section
   (`routes/index.tsx` line 751), props: `script=DEMO_SCRIPT_EN`,
   `scriptEs=DEMO_SCRIPT_ES`, `quote=DEMO_QUOTE_EN`, `quoteEs=DEMO_QUOTE_ES`,
   `messageCopy="Message"`, `messageCopyEs="Mensaje"`, `autoPlayOnView`.
   See `components/phone-chat/`.
- No DashSidebar/DashTopbar/MobileViewport here — this is the marketing surface,
  not the app shell. No shared app components apply.

## Section layout (top → bottom; all `static` unless noted)
| # | Section | Key hooks / notes |
|---|---|---|
| 1 | `.nav-wrap > .container.nav` | `.brand` (img+span+em), `.lang-toggle` (two `data-lang` buttons, `role=tablist`), `.nav-links` anchors, `.btn-outline` → `/login`, `.btn-primary.cta-scroll` → `#contact` |
| 2 | `.hero` | `.kicker` pill; `<h1>` with the **rotor** (`#rotor-track > .word[data-en][data-es]` × 4: quotes/contracts/invoices/paperwork); `.hero-ctas`; `.hero-trust` avatars; `.hero-visual > .hero-stage` (decorative `.hs-blob`, `.hs-badge`, `.hs-doc`, `.hs-phone` static mockup, `.spark` sparkles) |
| 3 | `.marquee > #marquee-track` | one `<span data-en="…|…" data-es="…|…">`; JS builds two duplicated segments for the loop |
| 4 | `.problem` | section-head + 3 `.problem-card` (01/02/03) |
| 5 | `.docs` | `.doc-tabs` (3 `.doc-tab[data-doc]` quote/contract/invoice); `.doc-mockup` (`#doc-title/#doc-num/#doc-date/#doc-lines/#doc-totals`); `.doc-info` (`#doc-info-title/body/list`); `.doc-counter` with count-up `#doc-counter-num` |
| 6 | `.features#features` | 4 `.feature` cards w/ icon variants **pink / green / teal / coffee** |
| 7 | `.how#how-it-works` | 3 `.how-step` (num-circle 1/2/3) |
| 8 | `.demo` | `.demo-info` (eyebrow + testimonial) **+ `<PhoneChat>` island** |
| 9 | `.pricing#pricing` | 3 `.tier` (Starter $15 / **Pro $99 `.featured` + `.tier-badge`** / Crew $199), `.cta-scroll` CTAs |
| 10 | `.contact#contact` | `.contact-card` = `.contact-info` (`.pm-steps` 1-2-3 + checks) **+ inline `<form id="contact-form">`** with the SMS-preview phone `.cf-phone`, saved-phone chip `#cf-saved`, compose `#f-phone`, `.cf-cta` submit, `.cf-trust` |
| 11 | `.footer` | brand + links + copy |

## Events (from `static/landing-scripts.js` — the page's behavior layer)
- **Language resolve + persist (on load):** active lang = `?lang=` (URL) >
  `localStorage["pm:lang"]` > `"en"`; mirrored back to `localStorage["pm:lang"]`
  AND a `pm_lang` cookie (so the SSR `/login` & `/verify` routes render in the
  chosen language). `applyLang(lang)` swaps every `[data-i18n]` (`textContent`,
  or `innerHTML` when `data-html="1"`), the rotor words (`data-en|es`), the
  marquee (`data-en|es` split on `|`, rebuilt as 2 segments), re-renders the doc
  tab + (dead) chat, re-fits the rotor, toggles `.lang-toggle .on`.
  - `ev.expect(e => e.source===".lang-toggle button" && e.type==="click")` →
    `applyLang(btn.dataset.lang)` + `writeLangToUrl` (history.replaceState).
- **Hero rotor:** `setInterval(2200ms)` cycles 4 words — current gets `.out`,
  next gets `.in` (after a double rAF); `.out` removed after 600ms. `fitRotor()`
  measures the widest word with a hidden probe span and sets `#rotor-track`
  width (re-runs on `document.fonts.ready`, next rAF, +1s, and `resize` — to fix
  Safari's fallback-font clip).
- **Smooth scroll:** every `a[href^="#"]` → `scrollIntoView({behavior:"smooth"})`;
  scrolling to `#contact` focuses `#f-phone` after 600ms.
- **Doc tabs:** click a `.doc-tab` → set `.on`, `renderDoc(dataset.doc)` rebuilds
  `#doc-lines`/`#doc-totals`/`#doc-info-*` from the bilingual `DOC_CONTENT` dict.
- **Count-up:** IntersectionObserver (threshold 0.3) on `#doc-counter-num` →
  cubic-ease count 0→48,217 over 1800ms, locale-formatted (es-ES / en-US). Fires once.
- **Contact form (`#contact-form`):**
  - `#f-phone` input is live-masked via `formatPhone` (`(555) 123-4567`).
  - **Saved-phone chip:** on load, if `localStorage["pm:last-phone"]` exists,
    un-hides `#cf-saved` showing the formatted number; clicking `#cf-saved-btn`
    fills + `requestSubmit()`s the form; `#cf-saved-dismiss` removes the stored
    number + re-hides the chip.
  - **Submit:** `preventDefault` → `toE164` → guard `<10` digits (refocus) →
    set CTA to "Sending…"/"Enviando…" → **POST `/api/auth/send-otp`**
    `{phoneNumber, language}` → on ok, save `localStorage["pm:last-phone"]` and
    `location.href = "/verify?phone=<e164>&lang=<curLang>"`; on error, restore
    CTA + write a red error into `#cf-meta`.
  - `ev.expect(e => e.source==="form#contact-form" && e.type==="submit")`.
- **`init`:** `applyLang(curLang); renderDoc("quote"); renderChat()`.

## Motion (extracted from landing.css; durations are real)
- **Rotor word in/out:** `transform 520ms cubic-bezier(.34,1.4,.64,1)`, `opacity
  380ms`, `filter blur 380ms` — `.in` rises from `translateY(60%)+blur(6px)`,
  `.out` exits to `translateY(-60%)+blur(6px)`. The `.rotor` chip itself is a
  pink `rotate(-1.5deg)` tab. **Jank:** JS sets `#rotor-track` width per active
  word; mis-timed font load clips the word until `fitRotor` re-runs (handled).
- **Marquee:** `@keyframes marquee` `translateX(0→-50%)` over **38s** linear
  infinite (two duplicated segments make the loop seamless).
- **Decorative hero floats:** `phoneFloat 6s`, `blobDrift`, `docFloat`,
  `badgeFloat`, `twinkle` (sparkles) — ambient infinite loops on `.hs-*`/`.spark`.
- **Count-up:** rAF cubic-ease over 1800ms (JS, not CSS).
- **Contact phone:** `cfPulse` (live dot), `cfDot`, `cfSlideIn` keyframes;
  `.cf-saved__btn` hover `translateY(-1px)`.
- **Button spinner:** `spin 0.7s linear` (`.spinner`, loading states).
- **Reduced motion:** landing.css has **3** `@media (prefers-reduced-motion:
  reduce)` blocks — a global `*{animation/transition-duration:0.01ms!important}`
  clamp, `html{scroll-behavior:auto}`, and the `.pm-steps` active-dot pulse off.
  **The rebuild must preserve all three.**

## Responsive (landing's own breakpoints — read css/landing.css)
- `@media (max-width:980px)` — main layout collapse (hero/demo/grids stack).
- `@media (max-width:560px)` — `.hero-grid` → single column AND **`.hero-visual`
  is `display:none`** (the ~460px phone mockup caused horizontal scroll on
  phones). The marketing container is `max-width:1200px`.
- (No 720px breakpoint here — that's the product surface; landing uses 980/560.)

## A11y
- `.lang-toggle` is `role="tablist"` with two buttons (no `aria-selected` /
  `role=tab` on them — gap). `.pm-steps` has `aria-label`. Decorative SVGs are
  unlabeled (acceptable). Smooth-scroll respects reduced motion. The hero visual
  is `aria-hidden="true"`. `data-html` injects trusted inline `<em>` only.

## Build / composition order
1. Tokens + `static/landing.css` (or the `@theme` rebuild) loaded first.
2. SSR the static section tree (nav→hero→marquee→problem→docs→features→how→
   demo→pricing→contact→footer) with all `data-*` hooks intact.
3. Mount the **PhoneChat** island in `.demo` (props = the hardcoded DEMO_* arrays).
4. Load `static/landing-scripts.js` `defer` — it wires language, rotor, marquee,
   doc tabs, count-up, smooth-scroll, contact form, saved-phone chip on
   DOMContentLoaded-equivalent (defer).
5. (Rebuild decision) The i18n landing copy currently lives **twice**: literal EN
   in the JSX + the full `I18N`/`DOC_CONTENT`/`CHAT_SCRIPT` dicts inside
   `landing-scripts.js`. A clean rebuild should source both from `lang/*.json`.

## Dead code (verified zero mounts — NO folders created for these)
- `islands/LandingScripts.tsx` — the page loads the vanilla `landing-scripts.js`
  instead; the island is never imported by `routes/index.tsx` (only a stale
  comment mentions `<LandingScripts>`). DEAD.
- `islands/HeroRotor.tsx` — the rotor is the SSR `#rotor-track` + the vanilla JS;
  zero imports. DEAD.
- `islands/DemoPhoneChat.tsx` — superseded by `PhoneChat` (mounted) + the demo's
  reveal logic; zero imports. DEAD.
- `islands/ContactForm.tsx` — the landing contact form is inline `<form
  id="contact-form">` markup driven by `landing-scripts.js`, not this island;
  zero imports. DEAD.
- **Dead WITHIN the live JS:** `landing-scripts.js`'s `renderChat()`,
  `startReveal()`, `resetReveal()`, `quoteCardHTML()`, `CHAT_SCRIPT` target
  `#chat-body`/`.chat-step`/`#chat-fill` — the route renders no such ids (the
  PhoneChat island owns the demo with `class="chat-body"`), so they early-return.
  Legacy from when the demo was server-rendered static markup.

## Anti-patterns flagged
- **i18n copy duplicated** across JSX literals and the JS `I18N` dict (drift
  risk; the app already has `lang/*.json`). Fix: render `data-i18n` text from
  `tFor` SSR and drop the JS dict, or generate the JS dict from the JSON.
- **Dead chat code in a live file** (`renderChat`/`startReveal`) — confusing
  no-ops shipped to every visitor. Fix: delete now that PhoneChat owns the demo.
- **Behavior layer is a `<script>` tag, not an island** — intentional workaround
  for a (since-possibly-fixed) hydration bug. Worth re-evaluating: the rotor /
  doc-tabs / count-up are classic island candidates. Not a correctness bug, but
  it bypasses Fresh's hydration entirely. No `location.reload()` anti-pattern on
  this page (the contact form does a forward nav to `/verify`, which is correct).
