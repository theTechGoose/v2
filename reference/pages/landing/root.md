# Landing Page — Root

> **Status:** Production-target page. **The landing IS the login** — the contact-form's phone-input is the OTP-request step. On submit, route to `/verify?phone=…` (see `pages/verify/root.md`). Implement first — it also establishes the design-system primitives reused on Dashboard and Assistant.

![Hero reference](../../paperwork-monsters/project/screenshots/landing-hero-v5.png)
![Stage variant](../../paperwork-monsters/project/screenshots/landing-stage.png)

## Purpose

Public marketing landing page. Pitch the product to contractors, bilingual (EN/ES), end with a phone-number lead-capture form. No auth, no app shell. Search-engine indexable, fast TTI on mobile.

## Source

- **Prototype HTML:** `v2/reference/paperwork-monsters/project/Paperwork Monsters Landing.html` (3027 lines)
- **Prototype CSS:** `paperwork-monsters/project/styles.css` (lines 1–1175) + `colors_and_type.css` (full file)
- **Prototype JS:** inline `<script>` block at lines 2478–2546 (i18n, rotor, doc tabs, counter, chat reveal, contact form)

## Route

```
v2/frontend/routes/index.tsx                 → "/"  (Fresh route, server-rendered)
```

The page is server-rendered HTML with **two interactive islands** (described below). All copy is delivered server-side in the active language; the language toggle re-renders client-side. Default `Accept-Language` → fallback `en`.

## Stack notes

- **Fresh 2 (Preact SSR)** + **Tailwind 4** via `@tailwindcss/vite`
- **Design tokens** from `colors_and_type.css` map into `tailwind.config.ts` `theme.extend.colors`/`spacing`/`borderRadius` etc. — see `pages/landing/components/nav.md` §Tailwind mapping for the full table; reuse the same theme on Dashboard + Assistant.
- **Static assets to copy into `v2/frontend/static/`:**
  - `paperwork-monsters/project/assets/logo-monster.png` → `static/logo-monster.png` (1.2 MB — consider re-exporting to WebP at 256 px width to drop ~80%)
  - `paperwork-monsters/project/assets/confetti-pattern.svg` → `static/confetti-pattern.svg`
- **Fonts:** Google Fonts `Nunito` (400/500/600/700/800) + `Inter` (400/500/600/700) via `<link>` in `routes/_app.tsx`. Self-hosting is a v2 nice-to-have (see `colors_and_type.css` §1).

## Layout (top-down)

```
<NavWrap>                           — sticky, blurred, EN/ES toggle, anchor links, primary CTA
  <Nav />                           → components/nav.md
<Hero>                              — headline w/ rotating word, lead, CTAs, trust strip
  <Hero />                          → components/hero.md  (ISLAND: word rotor)
<Marquee />                         → components/marquee.md
<Problem>                           — 3-column problem cards
  <ProblemCards />                  → components/problem-cards.md
<Docs id="docs">                    — tab switcher → mockup of Quote/Contract/Invoice + counter
  <DocTabs />                       → components/doc-tabs.md  (ISLAND: tabs + animated counter)
<Features id="features">            — 2×2 feature grid
  <FeaturesGrid />                  → components/features-grid.md
<HowItWorks id="how-it-works">      — 3 numbered steps
  <HowItWorks />                    → components/how-it-works.md
<Demo>                              — testimonial + iPhone mockup w/ scroll-revealed chat
  <DemoPhoneChat />                 → components/demo-phone-chat.md  (ISLAND: IO-driven reveal)
<Pricing id="pricing">              — without/with comparison + callout
  <Pricing />                       → components/pricing.md
<Contact id="contact">              — phone-number form w/ live SMS-bubble preview
  <ContactForm />                   → components/contact-form.md  (ISLAND: input formatter + simulated send)
<Footer />                          → components/footer.md
```

The whole page **re-renders client-side on language change** to update copy + rotor words + marquee content + chat script. See `components/i18n.md` for the strategy.

## Page-level state

| State | Where | Why |
|---|---|---|
| `lang: 'en'\|'es'` | `pages/landing/components/i18n.md` — kept in a Preact signal `langSignal` | Toggle in nav, plus all interactive islands subscribe |
| `activeDoc: 'quote'\|'contract'\|'invoice'` | Inside `DocTabs` island | Local — no need for cross-island access |
| `chatRevealed: boolean` | Inside `DemoPhoneChat` island | Local — IntersectionObserver-driven |

No global page state beyond `langSignal`. Everything else is component-local.

## Backend dependencies

**`POST /api/auth/send-otp`** — fired by the contact-form on submit. See `backend.md` §2.A. The Fresh proxy at `routes/api/auth/send-otp.ts` forwards to v2/backend `POST /auth/send-otp`. After a `{ sent: true }` response, the form navigates to `/verify?phone=<encoded>`.

If a contractor with this phone already exists, they log in. If not, the backend auto-creates the contractor record on `verify-otp` success (only `id` + `phoneNumber` populated; the rest of the profile fills in via `/dashboard/settings`).

## Auth

Public route — but it **initiates** the auth flow. If the user is already logged in (valid `x-session-id` cookie), the route handler should `Response.redirect('/dashboard', 302)` server-side rather than render the marketing copy.

## Mobile breakpoints

The prototype uses a single breakpoint at `980px` (see `styles.css` lines 1159–1175). Below that:
- Nav links hide (use a hamburger? — prototype hides without replacement; production should add a mobile menu)
- Hero grid collapses to single column, visual centered, `height: 480px`
- Problem grid → 1 col, Doc stage → 1 col, Features → 1 col, How → 1 col (dashed connector hidden)
- Pricing math arrow rotates 90°
- Contact card → 1 col

Recommend Tailwind breakpoint mapping: `lg:` for the desktop layout, default for mobile.

## Implementation order

1. **Tailwind theme** (`tailwind.config.ts`) — port every CSS var from `colors_and_type.css` into `theme.extend`. Without this, every component is fighting the system.
2. **`Nav`** — establishes the `.brand` mark, `.btn-primary`, and the EN/ES toggle that other components react to.
3. **i18n signal** (`lib/lang-signal.ts`) — single source of truth before adding interactive islands.
4. **`Hero`** + word rotor (the most visually loaded component; nail this and the rest of the page is easier).
5. **`Marquee`**, **`ProblemCards`**, **`FeaturesGrid`**, **`HowItWorks`** — pure layout, no JS.
6. **`DocTabs`** + counter animation — requires the design-system primitives from earlier components.
7. **`DemoPhoneChat`** — IntersectionObserver + scripted reveal.
8. **`Pricing`** + **`ContactForm`** + **`Footer`** — wrap up.

## What NOT to port

- `tweaks-panel.jsx` — dev tool only. Not on landing page anyway, but called out in case someone is tempted.
- The base64-inlined `logo-monster.png` data-URI in the HTML's `<img>` tags — copy the file to `static/` and reference by path. The data-URI alone is ~1.6 MB.
- The hero `<img>` in `hs-doc__sign-line` (a hand-drawn signature) — reuse the SVG checkmark instead, the prototype's signature is purely decorative.

## Conventions for component docs in this folder

Every `components/<x>.md` file follows the schema from `lets-think-step-by-breezy-yeti.md` plan: Purpose · Screenshot · Source location · HTML · CSS · JS · Props · Data · Island/server · A11y · Edge cases. Code blocks are **verbatim from the prototype**; the Tailwind/Preact translation is in a separate sub-section so the original is preserved as the source of truth.

## Quick reference: shared primitives

These appear in multiple components and should be implemented once:

| Primitive | Where defined in prototype | Used by |
|---|---|---|
| `.btn-primary` (pink) | `styles.css:80–87` | nav, hero, pricing-callout, contact-form |
| `.btn-outline` (white/teal) | `styles.css:91–96` | hero |
| `.btn-lg` (size variant) | `styles.css:89` | hero |
| `.eyebrow-pill` (green pill) | `styles.css:421–432` | every section header |
| `.section-head` (centered hero block) | `styles.css:434–453` | every section |
| `.kicker` (white pill w/ green chip) | `styles.css:126–143` | hero |
| `.container` (max-width 1200, fluid padding) | `styles.css:15–19` | every section |

Build them as Preact components in `v2/frontend/components/ui/` and import everywhere.
