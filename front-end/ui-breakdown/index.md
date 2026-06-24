# Paperwork Monster — UI breakdown / build spec

Reverse-documentation of the existing **Fresh 2 (Preact + Tailwind 4)** app at
`front-end/`, decomposed into a build spec a later session can rebuild from
**mechanically**, page by page and component by component, without opening the
source. Because the source is fully readable TypeScript/CSS (not an opaque
mock), classification is **ground truth, not inference**: `islands/` → island,
`components/` → static / page-composition, `routes/` → page.

Start here, then read `design-tokens.md` and `data-model.md`, then the page +
component specs.

## How this maps to the source
- **Tokens:** the "Sabor Design System" CSS custom properties (`design-tokens.md`).
  Single light theme — no dark mode anywhere.
- **Two surfaces:** the **authenticated app** (Sabor tokens, semantic CSS classes
  per feature file) and the **public customer-facing** pages (`/q /c /co /i` —
  their own inline-styled palette; see `design-tokens.md` § Public surface).
- **Data:** see `data-model.md` (entities, enums, endpoint map, hazards). All
  stored entities are user-owned (carry a `userId`).

---

## Page inventory
| Page (folder) | Route(s) | Purpose | Key components |
|---|---|---|---|
| `landing` | `/` (`index.tsx`) | Marketing site (static + vanilla-JS animation in `static/landing-scripts.js`) | phone-chat (island); rest is inline markup |
| `login` | `/login` | Phone entry (auth step 1) | login-form |
| `verify` | `/verify?phone=` | OTP entry (auth step 2; dev OTP `000000`) | code-input |
| `dashboard` | `/dashboard` | Home: stats, sections, setup checklist | dashboard-page, dash-sections, ticker, setup-checklist, assistant-coachmark, welcome-back-toast |
| `quotes` | `/quotes` | Quote pipeline | quotes-page, quotes-sections, quote-card, delete-quote-button |
| `contracts` | `/contracts` | Contracts list (derived `mood`) | contracts-page, contracts-sections, contract-card, contract-track |
| `invoices` | `/invoices` | Invoice list + create/schedule/send | invoices-page, invoices-hero, invoices-kpis, invoice-card, new-invoice-modal |
| `payments` | `/payments` | Manual-only payments (claim→confirm) | payments-page, payments-hero, payments-kpis, payment-card, payment-side-rail, landed-row |
| `clients` | `/clients` | Customer board (derived status/segment) | clients-page, clients-sections, clients-board |
| `assistant` | `/assistant`, `/assistant/:threadId` | AI chat ("Bossie"); `/messages` 302s here | asst-chat, asst-threads, chat-header-live, money-input, onboarding-progress, redirect-toast |
| `settings` | `/settings` | Business profile + danger-zone wipe | settings-page |
| `admin` | `/admin` | Super-admin user table + impersonation | admin-page |
| `accounts-manager` | `/accounts-manager` | Shell-only stub (honest-empty) | — |
| `public-quote` | `/q/:id` | Customer quote doc + accept/decline | public-quote-actions, public-accept-quote |
| `public-change-order` | `/co/:id` | Customer change-order doc + approve/decline | public-change-order-actions |
| `public-contract` | `/c/:id` | Customer contract doc + sign | public-contract-view, public-sign-contract (+ shared `contract-doc`) |
| `public-invoice` | `/i/:id` | Customer invoice doc + claim payment | public-invoice-claim |

**Redirect-only routes (not pages):** `/messages` → `/assistant?from=messages`;
`/s/:code` → resolves a shortlink then 302s to `/q|/c|/i`; `/test.tsx` trivial
dev page; `routes/api/*` (auth + `[...path]` proxy) are backend plumbing.

---

## Shared-component usage matrix
(`shared-components/`; ✓ = used on that page. App = the 10 shell pages
dashboard/quotes/contracts/invoices/payments/clients/assistant/settings/admin/accounts-manager.)

| Component | Tier | Used on |
|---|---|---|
| `mobile-viewport` | island (behavior-only, renders null) | **every page** (global, `_app.tsx`) |
| `impersonation-banner` | island (self-gating) | **every page** (global, `_app.tsx`) |
| `dash-sidebar` | island | all 10 App pages |
| `dash-topbar` | island | all 10 App pages |
| `skeletons` | static | dashboard, quotes, contracts, invoices, payments, clients, settings (7) |
| `quote-track` | island | quotes, invoices, payments (3) |
| `contract-doc` | static / page-composition | public-contract route + PublicContractView island |
| `ui-section-head` | static | contract-doc (1) — transitively the public-contract surface |
| `ui-button` | static | **built-but-unwired** (0 live; only the Counter story) |
| `ui-icon` | static | only via dead `Composer` → effectively unwired |
| `ui-brand` | static | only via dead `AppNav` → transitively dead |

---

## Interaction / tier summary (the runtime architecture)

**The dominant pattern is the "whole-page island."** Every authenticated feature
page mounts the app shell (`DashSidebar` + `DashTopbar`) around a single large
island (`DashboardPage`, `QuotesPage`, `ContractsPage`, `InvoicesPage`,
`PaymentsPage`, `ClientsPage`, `SettingsPage`, `AdminPage`) that **client-fetches
its data on mount** via `clients/*.ts`. This is the codebase's central
**anti-pattern**: several of these (and the impersonation/logout/wipe paths)
`location.reload()` / `location.href=…` after a mutation to re-read server state.

> **Rebuild target for each:** keep client-only interactions (filters, modals,
> disclosure) as islands, but move **server mutations** to `<form method=POST>`
> + **Post/Redirect/Get** (303 → re-render) or a **Fresh Partial** for in-place
> fragment refresh, with feedback as a **flash message** on the redirect — never
> a client toast + `location.reload()`. Each component spec names its specific
> fix. (Some `location.href` navigations after a cookie/session swap — logout,
> impersonate, account-wipe → `/login` — are legitimately navigations, not
> reload-to-refresh; those are flagged "mild / justified".)

**Public pages do it right:** SSR documents (`ssrBackendGet…`) with small
client-action islands (accept / sign / claim). Keep that shape.

**Auth pages:** static SSR shell + one small island (LoginForm / CodeInput).

**Pushed / live (need a stream at build time):**
- `AsstChat` voice dictation → **websocket** `/api/voice/stream` (Vite proxies
  the upgrade to the backend `/voice/stream` → AssemblyAI). The only genuinely
  pushed channel. Everything else is request-response.
- `DashTopbar` **polls** (notifications 10 s, unread 30 s, ticker rotate 3.8 s) —
  flagged: back off / consolidate / move to SSE.

**Cross-island coupling:** `DashTopbar` dispatches a `window` `pm:sb-toggle`
event that `DashSidebar` listens for (string-keyed event bus instead of a shared
signal) — flagged fragile.

**Data-shape hazards (design-time, not benchmarked — see `data-model.md` §5):**
DashboardStats whole-account rollup rendered in the shell on every page
(`lib/dash-cache.ts` is the existing mitigation); sidebar unread badge; `/clients`
N×per-customer rollups + global top/segments; `/quotes` engagement/stage
derivation; invoice aging buckets; payment-sum rollups over jobs; the public
`/…/public` composite-read **join fan-outs** (invoice → contract → quote →
customer → profile → methods → siblings) on every customer link-load.

---

## Build order
1. **Design tokens** → Tailwind 4 `@theme` (`design-tokens.md`).
2. **Shared primitives** (no deps): `ui-button`, `ui-icon`, `ui-brand`,
   `ui-section-head`, `skeletons`.
3. **Shared cross-cutting + app shell**: `mobile-viewport`, `impersonation-banner`,
   then `dash-sidebar`, `dash-topbar`, `quote-track`.
4. **Shared composite**: `contract-doc` (uses `ui-section-head` + embeds
   `public-sign-contract`).
5. **Per-page**: primitives → composites → the page island, in dependency order
   (e.g. `quote-card` / `quotes-sections` before `quotes-page`; `payment-card` /
   `payments-kpis` / `payments-hero` before `payments-page`; `money-input` +
   `quote-card` before `asst-chat`).
6. **Page compositions** (the route shells).

Public surface is independent of Sabor — build its primitives from the public
palette, not the app tokens.

---

## Confirmed dead / unused code (do NOT rebuild)
Verified by zero live references (import + JSX + string) across `routes/ islands/
components/ lib/ clients/ static/`:
- **Islands:** `HeroRotor`, `DemoPhoneChat`, `LandingScripts` (landing animation
  is the vanilla `static/landing-scripts.js` + `#rotor-track`, not these),
  `ContactForm` (landing's contact form is inline; `clients` uses an inline form
  in `ClientsBoard`), `AsstComposer`, `Composer`, `DocTabs`, `Counter` (story-only).
- **Components:** `AppNav` (orphaned — and the only consumer of `ui/Brand`),
  `AssistantSections`, `MessageBubble`.
- **Built-but-unwired primitives:** `components/ui/Button.tsx`,
  `components/ui/SectionHead.tsx` (SectionHead is, however, used by `contract-doc`
  — so it IS live there), and `components/Button.tsx` (legacy, Counter-story only;
  superseded by `ui/Button`).
- **CSS-only dead:** `pm-assistant-shake` keyframes (no selector assigns it);
  `.sb__brand-sub` / `.sb__textus-tag` / `.sb__label`, `.topbar__search` /
  `.topbar__btn` (styled, not rendered); a stray `.__unused__` rule in
  `dashboard.css`; `.dashpage-error` and `.settings-edit__input` are *referenced
  in markup but have no CSS rule* (render unstyled — confirm intent).

---

## Risks / unknowns the build session should verify early
- **Screenshots are pending.** No running backend this session, and the app is
  auth-gated, so component specs carry a `capture-checklist.md` (route, dev OTP
  `000000`, real `@media` viewports, states to drive) instead of fabricated
  stills. Run captures against a seeded dev backend before pixel-diffing.
- **`AsstChat` (8450 LOC)** is documented as a faithful **macro** decomposition
  (message-type taxonomy, composer, quote/terms phases, voice ws), not a
  line-by-line transcription — expect to refine its sub-component split during build.
- **Units:** several money fields are bare `amount`/`value` that are **cents** by
  convention (per `lib/format.ts` + `dashboard.ts` comments) but aren't annotated;
  `data-model.md` flags the ambiguous ones. Verify at the API boundary.
- **Timestamps** are inconsistent (epoch-ms numbers on User/Message vs ISO strings
  elsewhere) — `data-model.md` § Open questions.
- **Breakpoints:** the app shell cuts at **640/641px**, not the product-wide
  720px — always use a component's *own* `@media` widths.
- **Two icon systems** (`ui/Icon` 16-name vs `lib/dash-icons` ~50-glyph) and
  **dual `.btn`/`.brand`/`.section-head`** definitions across `verify.css` vs
  `landing.css` vs `dashboard.css` — the `ui-*` primitives ship no CSS of their
  own, so their look depends on which feature stylesheet the host page loaded.

---

## Completeness audit

`Unassigned: none` — every route maps to a page folder (or a documented
redirect), and every live island/component maps to a spec folder; every dead
module is in the dead-code list above.

**Totals:** 17 page folders · 11 shared components · **56 components** with a
real `isolate/` proposal · **282** case files · 137 `.md` specs · 61
`capture-checklist.md` · **338/338 isolate+case JSON validate** (0 invalid,
0 empty case dirs). Capture pass (live screenshots) intentionally deferred to
the build session per the capture policy (auth-gated, no running backend).

**Per-page spec status — all complete:**
| Page | Components | Status |
|---|---|---|
| landing | phone-chat | ✅ md+css+js+isolate; vanilla `landing-scripts.js` documented |
| login | login-form | ✅ |
| verify | code-input | ✅ |
| dashboard | dashboard-page, dash-sections, ticker, setup-checklist, assistant-coachmark, welcome-back-toast | ✅ |
| quotes | quotes-page, quotes-sections, quote-card, delete-quote-button | ✅ |
| contracts | contracts-page, contracts-sections, contract-card, contract-track | ✅ |
| invoices | invoices-page, invoices-hero, invoices-kpis, invoice-card, new-invoice-modal | ✅ |
| payments | payments-page, payments-hero, payments-kpis, payment-card, payment-side-rail, landed-row | ✅ |
| clients | clients-page, clients-sections, clients-board | ✅ |
| assistant | asst-chat (macro decomp), asst-threads, chat-header-live, money-input, onboarding-progress, redirect-toast | ✅ |
| settings | settings-page | ✅ |
| admin | admin-page | ✅ |
| accounts-manager | — (honest-empty stub) | ✅ documented stub |
| public-quote | public-quote-actions, public-accept-quote | ✅ |
| public-change-order | public-change-order-actions | ✅ |
| public-contract | public-contract-view, public-sign-contract | ✅ |
| public-invoice | public-invoice-claim | ✅ |
| shared-components | dash-sidebar, dash-topbar, mobile-viewport, impersonation-banner, skeletons, quote-track, contract-doc, ui-button, ui-icon, ui-brand, ui-section-head | ✅ |

### Known bugs / fixes surfaced during decomposition
Concrete issues the per-component specs found in the *current* source — the
rebuild should NOT reproduce them (each is detailed in the owning spec):

- **`location.reload()` after mutation** (the page-island anti-pattern's tail):
  `DeleteQuoteButton`, every `InvoiceCard` mutation + `new-invoice-modal` create,
  `PublicSignContract` (900 ms panel → hard reload). Fix: form+PRG / Fresh Partial
  / lift an `onDone` refetch. *(Payments & Contracts pages do NOT reload;
  `AsstChat` is a whole-page island done right — pure client state.)*
- **Unstyled classes** (referenced in markup, no CSS rule): `.qpage-error`,
  `.kpage-error`, `.dashpage-error`, `.settings-edit__input`; `PSideTopPayors`
  `.qside__*`; `LandedRow` `.qdone__body/__sub`. **CSS clip bug:**
  `.kcard__numeral{bottom:-18px}` under `overflow:hidden` clips the numeral
  (the sibling `.qcard__numeral` fix wasn't ported back).
- **Inert/no-op buttons:** `DashSections` nudge/view buttons, `QuotesHero`
  "New quote" CTA, `PaymentCard` front+back buttons (all `stopPropagation`-only).
- **A11y:** clickable `<header>`/`<article>`/`<div>` instead of buttons
  (QuoteTrack, ContractTrack, ContractCard flip); `PublicSignContract` is
  pointer-only → keyboard/SR users **cannot sign**; mobile sidebar drawer + Add-
  client modal have no focus-trap/Esc; missing `aria-current`/`aria-expanded`/
  `aria-pressed`.
- **Synthesized "data fiction":** `ContractCard` progress + back-face milestones,
  `PaymentsPage` client-derived status (`attention` mood structurally
  unreachable), `PSideFlow` trend bucketed by array index not `receivedAt`.
- **Polling / event buses:** `DashTopbar` polls (10 s/30 s/3.8 s);
  `pm:sb-toggle` (sidebar↔topbar), `pm:asst-*` (AsstChat↔ChatHeaderLive),
  `AssistantCoachmark` string-queries `.sb__textus` 30×120 ms.
- **Reduced-motion gaps:** `Ticker` rAF count-up + skeleton shimmer rely on the
  global tokens clamp with no component-local guard.

> Two earlier sub-agent runs were interrupted (one no-op'd; the account session
> limit truncated the first page-spec wave). A second finishing pass completed
> every gap; the counts above are the post-finishing verified state.
