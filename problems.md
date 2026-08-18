# problems.md — First-2-Hours Adversarial Audit (pre-Facebook-ads)

**Date:** 2026-08-17 · **Method:** 5 adversarial agents against the LIVE app (mobile-first, Spanish-first persona) + code verification. Every finding below was observed live or proven in source — file:line cited where known. **No fixes applied — findings only.**

**Severity:** 🔴 BLOCKER = burns money or trust at scale the day ads go live · 🟠 MAJOR = visibly sloppy/confusing at a moment of trust · 🟡 MINOR = noticeable rough edge · ⚪ POLISH = nitpick.

**TL;DR — do not buy ads until the 8 blockers are closed.** Every ad and every forwarded quote link previews as a blank gray box (no OG tags), none of the spend can be attributed (no pixel), the OTP endpoint is an open Twilio bill (no rate limit), the Spanish onboarding has a literal dead-loop ("omitir"), skip-setup users text their customers as "Nuevo usuario", and the Spanish contractor's customer emails go out **in English** by default.

---

## 🔴 LAUNCH BLOCKERS

**P-01 [ADS] Zero Open Graph / Twitter Card tags on every page.**
`rg 'og:image|og:title|twitter:card'` across `front-end/` → nothing. `/`, `/landing`, and the public docs `/q /c /i` serve only charset/viewport/icon/title/description. Facebook renders every ad and reshare as a blank gray box; WhatsApp/iMessage previews of forwarded quote links (the audience's #1 channel) show a bare URL at the exact moment a customer receives a price. A ready share-card already exists unused: `front-end/static/logo-monster-card.png` (200 OK, 43KB, referenced only in `DashSidebar.tsx:236`).

**P-02 [ADS] No Facebook pixel, no analytics, no conversion event anywhere.**
Grep for gtag/fbq/fbevents/segment/posthog/plausible on live pages + source → nothing; the trial-signup form fires no event. Ad spend cannot be attributed, no cost-per-signup, no retargeting/lookalike audiences. (Corollary: no consent banner exists either — fine only while nothing is tracked.)

**P-03 [SECURITY/COST] `POST /api/auth/send-otp` is unauthenticated with ZERO rate limiting → SMS-pumping toll fraud.**
`send-otp/mod.ts:43-58`, `auth-controller/mod.ts:36-44`; the FE proxy forwards verbatim. No per-IP cap, per-number cap, CAPTCHA, or cooldown — every call is a real Twilio SMS in prod, and bots WILL find it once ads run (the `/contact` form has a limiter; this doesn't). Bonus hole: every re-send resets `attempts=0`, defeating the `MAX_ATTEMPTS=5` OTP brute-force guard (`verify-otp/mod.ts:171`). Live-proven: `{"sent":true}` with no auth.

**P-04 [SIGNUP/I18N] The Spanish onboarding tells users to type "omitir" — which the backend never accepts. Infinite loop.**
Composer placeholders + the failure re-prompt itself say `'omitir'` (`lang/es.json`: `asstChat.composer.address/email`, `onboardingChat.address.reprompt`), but the only skip parser is English: `SKIP_RE = /^(?:skip|later|not now|...)/i` (`backend/src/agents/domain/business/onboarding/mod.ts:37`; zero hits for "omitir" in backend). A Spanish user typing what the UI tells them gets re-prompted to type it again, forever. The assistant bubble even says type "skip" while the placeholder says "omitir".

**P-05 [OUTBOUND] Spanish-first contractors send their customers ENGLISH email by default.**
`commsLanguage` unset → `'en'` (`backend/src/users/dto/business-identity.ts`); setting the user's app language to ES never touches it. Live-proven: ES contractor's send produced subject "Sánchez Remodeling Quote for María García, Remodelación de Baño". Settings shows "Idiomas para enviar: Inglés ✓ / Español ☐" for an all-Spanish user. The first artifact the customer of a Spanish-funnel ad ever receives is in the wrong language.

**P-06 [OUTBOUND] "Nuevo usuario" / "New user" leaks into customer-facing email and SMS.**
Every account is seeded name "Nuevo usuario" (`verify-otp/mod.ts:35`) and nothing filters it from outbound copy. For skip-setup users (an explicitly supported path): email subject "Nuevo usuario Cotización para…", intro "Nuevo preparó esto para ti.", SMS "Hola María, soy Nuevo." (`send-paperwork-email/mod.ts:523-526,711-716`; `send-paperwork-sms/mod.ts:265-267,363-369`), invoice subject "…de Nuevo usuario", change-order alert "Nuevo usuario te envió un cambio", topbar "Hola, Nuevo 👋". The placeholder filter exists only in `WelcomeWizard.tsx:73`.

**P-07 [OUTBOUND] Accented Spanish job names are mangled in the email hero.**
`summaryClean.replace(/\b\w/g, c => c.toUpperCase())` (`send-paperwork-email/mod.ts:638,1026`) — non-Unicode `\b` fires after accents: "instalación de baño y cocina" renders as **"InstalacióN De BañO Y Cocina"** in the 36px headline of the quote AND invoice emails; also Title-Cases Spanish prepositions ("De", "Y").

**P-08 [LANDING] Two landing pages selling contradictory offers.**
`/landing`: "Prueba GRATIS por 30 días", "Papeleo ilimitado" as the $99 differentiator. `/`: no trial anywhere, "Sin cuotas iniciales… desde $15", unlimited included at $15. Marketing numbers also fight each other: "+1.200 contratistas" (hero) vs "34 contractors signed up this week" (form, hardcoded English) vs "48.215 documentos enviados". Whichever page the ad uses, the other reads as bait-and-switch on "free" and "unlimited".

---

## 🟠 MAJOR

**P-09 [OUTBOUND] Sends report success when delivery failed.** Backend returns `{ok:false}` at HTTP 200 (no recipient / Postmark bounce); `InvoicesPage.tsx:1422-1435,1551-1564` checks only HTTP `Response.ok` then reloads as success; `AsstChat.tsx:3043-3049` (swap-invoice) ignores the result entirely. A contractor whose customer has no/bounced email believes the invoice was delivered. (The assistant contract-send path IS honest — `emailFailed`/`noEmail` divider — and `PublicQuoteActions` handles it correctly; the asymmetry is the bug.) Live-proven: three `ok:false` + HTTP 200 cases.

**P-10 [ASSISTANT] No timeout on the LLM chat turn.** `backend/.../openai/mod.ts:80-101` uses SDK defaults (600s/attempt × 2 retries + its own retry); no AbortSignal from the frontend. A hung OpenAI call = spinner for minutes, no cancel, no error. (`generateJobOptions`/`suggestPrices` degrade gracefully via local heuristics; free-text chat has no fallback.)

**P-11 [PUBLIC] The public quote has no persisted accepted state.** After accepting and reloading `/q/:id`, María sees the pristine "type your name + Aceptar" UI again (server says `approved`); she can "accept" again, and decline only errors *after* submitting ("ya fue aceptada", via 409). A customer returning next day has zero evidence her acceptance registered. (`/c` and `/i` persist state correctly.)

**P-12 [PUBLIC] The money pages ignore localization — `/i` and `/co` are English-only.** With `pm_lang=es` in the same browser that rendered `/q` and `/c` in Spanish: "Bill to", "Amount due", "How would you like to pay?", "I sent it", "Approve this change" — 100% EN chrome on the highest-stakes customer surfaces.

**P-13 [PUBLIC] The contract never names the customer: "Para: —".** Before AND after signing. The public contract payload carries no customer block (the quote payload does). A suspicious customer reads "this isn't even for me" on a legal document.

**P-14 [DASHBOARD] The user's first quote is misreported as WON.** Minutes after sending (nobody signed), `/quotes` shows it under "Decididas este mes — 1 ganadas" with "En espera: $0 · 0"; `/dashboard` simultaneously says "esperando firma — 1 enviadas · $850", and it already counts as "1 trabajo activo" (empty-state copy promises jobs appear "en cuanto un cliente firme"). The first numbers the app ever shows are false and self-contradictory.

**P-15 [DASHBOARD] The onboarding sample quote pollutes real pipeline stats.** "/quotes" hero claims "$3,700 en trabajo en manos de los clientes" — entirely the "Paver Patio Installation" sample, complete with fabricated open-tracking ("1 apertura, Today · 9:42am · iPhone"), English strings ("Not sent yet — finish writing, then ship it.", "Drafting"), "1 cotización abierta en 0 clientes", and a leaked internal slug "onboarding-sample-v1 · #8b778011".

**P-16 [LANDING] Root hero rotates into broken Spanish.** "Nosotros manejamos las **contratos** / las **papeleo**" — the fixed article "las" only agrees with 2 of 4 rotor words (`landing-scripts.js:158` + `routes/index.tsx:217-235`). Headline-sized grammar errors on a product that sells writing.

**P-17 [LANDING] Root header is visually broken at 390px.** 194px-tall header; "Empezar" CTA wraps to its own row flush at x=0 (measured 104×47 @ 0,132) overlapping the hero boundary; "Entrar" and the language pill misaligned (y:62 vs y:79). First paint after the ad tap looks like a rendering bug.

**P-18 [LANDING] `/landing` language toggle is two mashed 20px underlined links** — reads "EspañolEnglish", far below the ~44px tap minimum, unstyled next to the polished header.

**P-19 [LANDING/I18N] Root hero showcase stays English in Spanish mode + EN-first SSR flash.** `applyLang` only swaps `[data-i18n]` nodes; the hero phone conversation, "Quote" tag, "Signed ✓", "Online • SMS" etc. are hardcoded EN (`routes/index.tsx:333-406`) — the dict even contains an orphaned `doc.q.tag: "Cotización"` that never applies. SSR is fully English with a Spanish title, flipping after hydration — a visible wrong-language flash on every first paint for the target audience.

**P-20 [ASSISTANT] All four starter chips return the identical canned reply — including "Trabajo terminado, necesito facturar", which is answered with quote copy.** The user who said "I need an invoice" is told about a cotización; the choices feel fake.

**P-21 [ASSISTANT] Terminology whiplash at the send moment.** The user builds a "Cotización + Acuerdo" → header flips to "Redactando **contrato**" → confirmation "**Contrato** enviado para firma" + an ALL-CAPS chip ("CONTRATO ENVIADO POR CORREO A PRUEBA@…"), toast truncates the email mid-address. Also `contractDoc.docTag` is "Quote **&** Agreement" while every other surface brands "Quote **+** Agreement" (the deck's rule) — broken on the very document the customer signs.

**P-22 [ASSISTANT] Past conversations unreachable on mobile; mid-flow work silently lost.** The 390px hamburger has nav links only — no conversation history; "Mi Asistente" always opens a new chat; a flow whose URL never gained a conversation id is unrecoverable after navigating away. (With an id, reload resumes correctly.)

**P-23 [ASSISTANT/I18N] The Spanish chat doesn't understand "sí".** Confirm parser is English-only (`onboarding/mod.ts:287`); the workaround chips are labeled "Sí — está correcto" but dispatch raw "Yes"/"different state"/"skip" — so the Spanish user's own chat bubble shows them speaking English.

**P-24 [ASSISTANT] The "choose a version" step undermines trust.** Three near-identical options titled "Reparar Cerca De", "… (2)", "… (3)"; meta-sentences become customer-facing bullets ("**No sé cuánto cobrar**" printed on the quote; "Son $850 por todo el trabajo" as a bullet); a later draft invented specifics never said ("1500 sqft, semi-brillante"); tapping a card's text opens inline editing (keyboard pops) instead of selecting. *(Dev-LLM caveat on content quality; the UI mechanics are real.)*

**P-25 [ASSISTANT/I18N] Manual terms controls write English into Spanish contracts.** Duration/warranty/payment fallbacks build EN strings and submit them verbatim: "El contrato dice: **Lifetime**", "3 weeks", "Net 30" (`AsstChat.tsx:7705,8075-8079,8479-8483`). Translated keys exist but are only used for the buttons.

**P-26 [ASSISTANT] The "English out" promise fails in the preview.** EN toggle translates the chrome but the job details stay Spanish in the English document — the single reason to pay ("papeleo profesional en inglés") visibly doesn't happen on the first try. EN send button also reads "Click here to send by Text + Email".

**P-27 [OUTBOUND] SMS sends the wrong-language job name.** `send-paperwork-sms/mod.ts:305,331` use raw `q.jobName` while the email path correctly projects `jobNameByLang[lang]` → "Your Quote + Agreement for **Remodelación de cocina** is ready".

**P-28 [OUTBOUND/PUBLIC] English/raw dates inside Spanish documents.** `fmtDate` is hardcoded `en-US` (`send-paperwork-email/mod.ts:372-387`): "Factura … vence **August 20, 2026**"; contract signature "Fecha: **August 18, 2026**"; invoice "Due **2026-09-17**" (raw ISO). Also UTC rendering shows tomorrow's date vs local time.

**P-29 [OUTBOUND] Raw English status enum in the Spanish invoice email** — "Estado: **Sent**" (`send-paperwork-email/mod.ts:1375`).

**P-30 [OUTBOUND] "Hola hola," SMS to unnamed customers.** ES `signedConfirm.sms.nameFallback` = "hola" fills "Hola {first}…" → "Hola hola, tu Cotización + Acuerdo…". (EN "Hi there" is fine.)

**P-31 [DESKTOP] `/invoices` detail panel looks bolted-on and hides its own controls.** Header clipped (clientHeight 61 vs scrollHeight 92, overflow:hidden — the "$3,200 · Esperando confirmación" line half-buried); body hides 203 of 419px behind an unmarked inner scroll, so Descuento/Orden de cambio and the CO status list are invisible; an EMPTY coral alert bar renders above "Ajustar factura"; ~100px dead whitespace; 407px-wide card on a 1440px screen; four identical outlined action buttons with no primary.

**P-32 [QUOTES] The receipts strip counts self-notifications as customer sends.** One email produced three "Enviada" lines: customer, the contractor's own CC, and "Enviada por SMS a **+1512555…412**" — the contractor's OWN phone (the accepted-alert). Roberto can believe María got an SMS she never received. No "Vista por el cliente" receipt despite `viewedAt` existing server-side.

**P-33 [I18N] ES users never get the post-onboarding payoff.** Ack detection string-matches English ("Nice to meet you,"… `AsstChat.tsx:1414-1425`); the Spanish acks never match, so the identity-card refresh and the "see what your customer sees" demo CTA silently never fire for the entire target audience.

**P-34 [CLIENTS] `/clients` headline is broken Spanish.** "Las **uno persona** que mantienen las luces encendidas.", "0 **sin contacto clientes**…", card metadata "**3m ago**", "1 trabajo activo · **active.**", "00 días atrás". Hardcoded EN error too: "Could not add client" (`ClientsPage.tsx:86`).

**P-35 [PLATFORM] Auth/not-found errors serialize as HTTP 500.** `UnauthorizedError`/`NotFoundError` → 500 (`require-user/mod.ts:6-11`); islands can't distinguish "logged out" from "server broke", so an expired session mid-action shows generic errors instead of a login redirect. (SSR page loads handle it; only island fetches bite.)

---

## 🟡 MINOR

**P-36 [DASHBOARD] Money numbers contradict across pages.** Dashboard "Outstanding $0 · Money owed $0" + aging bucket "**Current $0.01**" (visible one-cent artifact) while `/invoices` says "$3,100 esperados esta semana"; claimed-but-unconfirmed invoices count nowhere; "Reparar cerca… **Vence Sin fecha de vencimiento**" run-on (EN: "Due No due date"); "$850" displayed as "$0.8k"; "1 activos"; "Ver todo →" is a dead `href="#"`.

**P-37 [QUOTES] Giant empty-state hero shouts over real data** — "Todavía no hay nada en el pipeline. Crea tu primera cotización" directly above an APROBADA card and "Resueltas: 1" (hero only counts open quotes).

**P-38 [SIGNUP] Address autocomplete ignores the state confirmed 10 seconds earlier.** After "Sí, Texas", typing "1600 Congress" returns Chicago/Ypsilanti/Indianapolis/Cincinnati — zero Texas.

**P-39 [SIGNUP] "¿Número incorrecto? Editar" on /verify links to `/`** — dropping a `/landing`-originated user onto the *other* landing with no scroll target to the phone form.

**P-40 [PUBLIC] The drawn signature is captured, stored… and never shown.** Pad works on touch (draw/undo/clear verified; PNG persisted on the record) but neither the signed page nor the public payload renders it — the consent copy calls the drawing part of the signature, then it vanishes.

**P-41 [INVOICES] Integrity gaps in adjustments.** A discount applied AFTER the customer claimed payment silently changed the invoice $3,200 → $3,100 (claim was for $3,200, no warning); a customer-**approved** change order still offers "Editar"/"Eliminar".

**P-42 [SETTINGS] Three save models on one page.** Header promises "se guardan al instante"; address + payment methods need explicit Guardar; insurance/W-9 autosave on blur; "Valores del contrato" is a dead card ("Aún no hay nada." with no action).

**P-43 [I18N] "Deposit" is Depósito on the contract/wizard/dashboard but Anticipo on the invoice/settings** — the customer sees both words for the same payment.

**P-44 [OUTBOUND/I18N] ES email subject uses English word order** — "{businessName} Cotización para {customerName}…" instead of "Cotización de {businessName} para…". The single highest-visibility Spanish string in the product.

**P-45 [I18N] Preview vs contract label drift (ES):** "Tiempo de entrega" in the preview becomes "Duración" on the signed document.

**P-46 [I18N] EN naming drift + dated styling.** Sidebar "Customers" opens a page saying "No **clients** yet"; "View as client"; Title Case cluster "Click Here For Existing Customers" / "Pick a Customer" / "+ New Customer" amid sentence-case everywhere else.

**P-47 [I18N] Same-page ES label drift on /quotes:** "Resueltas este mes" (KPI) vs "Decididas este mes" (track); two different translations of "Out for response".

**P-48 [I18N] ES agreement slips:** "{n} días **vencido**" (should be vencidos); "Cotización + Acuerdo … está **lista/firmada**" gender bolted onto a mixed compound; "Enviado porque **T**u contratista…" (mid-sentence capital).

**P-49 [OUTBOUND] Invoice SMS begins lowercase for unnamed customers** — "tu factura está lista ($X)…".

**P-50 [OUTBOUND] Accepted-alert inconsistencies:** the with-job subject variant loses the ¡! and celebratory tone; uses raw `jobName` (no ByLang) so the ES contractor's alert can carry an EN job name.

**P-51 [OUTBOUND] "3 ea · $350.00 c/u" — the unit fallback "ea" leaks untranslated into ES emails** (`send-paperwork-email/mod.ts:653,1060`; `contractDoc.unitEach` = "c/u" exists unused here).

**P-52 [PRODUCT] Two names for the assistant:** onboarding/coachmark say "Bossie", the chat header and landing say "PM Assistant" — a first-session user meets both.

**P-53 [ASSISTANT] Desktop-keyboard hint on the mobile amount picker:** "↑ ↓ para ajustar $10 · **Shift = $100**" — no Shift key on a phone. Both price screens.

**P-54 [SIGNUP] Wizard step 4 (state) is the only step with no Atrás/Omitir buttons.**

**P-55 [ADS] `/robots.txt` and `/sitemap.xml` 404** — no way to keep `/q /c /i` customer documents out of search engines.

**P-56 [ADS] Unstyled plaintext 404.** A mistyped ad URL or stale link dumps a paid visitor on Fresh's default "Not Found" — no branding, no way back.

**P-57 [ADS] No `theme-color`, no manifest** — default gray mobile-Chrome address bar on 100%-mobile traffic.

**P-58 [PUBLIC] `/q` layout at 390px:** 56px horizontal overflow (contractor email cut at x=446/390 in the footer); qty/amount columns touch — renders "32$1,120.00".

**P-59 [I18N] Reverse leak in EN mode:** activity feed strings stay frozen in generation language ("María García rechazó tu orden de cambio" in an EN UI) + lowercase event strings ("your client signed the contract"); "Monster tip" body is English even in ES mode ("Most quotes are accepted within the first 48 hours…").

**P-60 [LANDING/I18N] `/landing` ES typos:** "**Chatéa** con nosotros" (the root page spells it right — the two pages disagree), "Legitimiza" (prefer Legitima), "crecer tu negocio" anglicism.

---

## ⚪ POLISH

**P-61** Win-rate template run-on, both languages: "0 **perdidasfaltan** 4 más…" / "0 **lostneed** 4 more…".
**P-62** No `@media print` on `/c` — printed contracts get raw screen CSS.
**P-63** Signed `/c` has no PDF download (the invoice does); footer still asks "¿Preguntas **antes de firmar**?" on a signed contract; `/q` question flow hides the action buttons until reload after submitting.
**P-64** Phone rendering: raw "5125556999" next to formatted "+1…"; `tel:5125556999` without +1 on /clients; "Dirección en archivo" claimed for a client with no address; mixed number locales on one page ("$ 10.990" vs "$10,990" vs "48.215").
**P-65** Chrome/misc: `<html>` has no `lang` attr while email shells hardcode `lang="en"` even for ES bodies; `aria-label="Language"` hardcoded; dev route `/test` ("Hello from /test") ships; hardcoded "Admin" label; dashboard ES date line starts lowercase ("viernes · agosto 17"); danger-zone makes Spanish users type "DELETE"; "garantía: 6 meses" chip lowercase beside capitalized siblings; "Exportar CSV" white-on-cream near-invisible; "No se pudo hacer profesional" calque (suggest "pulir el texto").
**P-66** `front-end/static/logo-email.png` is a 1.3MB publicly-served asset referenced by nothing on the web pages.
**P-67** Transient console noise around login/logout transitions (one 502 on `/api/admin/whoami`, ERR_CONNECTION_REFUSED on two polls); all steady-state pages console-clean.

---

## Verified CLEAN (checked adversarially — don't chase these)

- **OTP entry UX is excellent**: tel/numeric inputmodes, `one-time-code` autocomplete, auto-advance, auto-submit, Spanish inline errors, boxes reset+refocus on failure.
- **Master OTP `000000` is hard-disabled in prod** (`DENO_DEPLOYMENT_ID` guard). *Caveat: env-based — running prod off Deno Deploy without that var would re-enable it.*
- Wizard resumes at the right step after reload with data intact; back preserves values; send is double-tap-safe.
- `/c` and `/i` persist signed/claimed state cleanly; the invoice links the signed agreement; money math is correct everywhere it was checked (quote=contract=invoice; CO chains; discount recomputation).
- Signature pad genuinely works on touch (draw/undo/clear pixel-verified); emoji/apostrophe/accent names safe end-to-end (no XSS, correct escaping).
- Public bad links (`/q|/i|/co/BAD-ID`, `/s/BADCODE`) render graceful messages; double-accept is API-idempotent; declined-after-accepted is guarded.
- Zero-data dashboard math has no NaN/Infinity; sidebar collapse persists with a pre-paint script (no flash); viewport meta correct everywhere (no user-scalable=no); favicon/apple-touch resolve; titles distinct + branded in both languages; no external CDN scripts or web fonts; no image over 300KB on landing paths; no hardcoded localhost in shipping code; `DEV_BYPASS_AUTH` defaults off in prod.
- Zero app-generated console errors across the full customer + contractor journeys in steady state; no broken images.

## Dev-environment caveats

- Findings about LLM *content* (P-20, P-24) carry a dev-LLM caveat — re-verify against prod model output; the UI mechanics around them are real either way.
- All test users created during the audit were wiped via `GET /me/wipe` (17+27+43 records). One pre-existing dev user (+15125550937) was left alone.
