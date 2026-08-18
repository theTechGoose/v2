# TESTS-PROBLEMS — red TDD suite for problems.md

Every problem in `problems.md` (P-03 … P-67) has a failing (RED) test suite pinning the
**desired** behavior. A green agent's job is to make these pass **without editing the tests**.

Harness (same as TDD-QUOTE-FLOW):

- **Unit** — `cd jest && npx jest --selectProjects unit`. Pure logic. New contracts import
  from `shared/quote-flow/<module>` — those modules **do not exist yet**; "Cannot find
  module" is the intended red. Each unit file's header documents the exact export contract
  and the prod `file:line` where it must be wired.
- **Integration** — `cd jest && npx jest --selectProjects integration`. Real HTTP against
  the dev stack (`deno task serve`; in this container: backend booted directly with the
  stub LLM client + vite with `PORT=5280 BACKEND_URL=http://localhost:4280`). Verified
  red against the live stack on 2026-08-18.
- **E2E** — `cypress/e2e/*.cy.ts` (`cd cypress && npm run run`). Cypress cannot execute in
  this dev container (known quirk); the new specs are grounded selector-by-selector in the
  island/route source and typecheck clean.

Test-title convention: every `describe`/`it` starts with its problem id (`"P-07: …"`).
Phone blocks `+1512555{2000..3199}` are reserved per suite so specs never share user state.

## New shared/quote-flow module contracts (to be created by the green agent)

`otp-rate-limit` · `intent-parsers` · `email-format` · `outbound-identity` · `sms-i18n` ·
`send-result` · `public-doc-state` · `public-lang` · `pipeline-stats` · `receipts` ·
`adjustment-guards` · `landing-rotor` · `landing-offers` · `chat-timeout` ·
`starter-chips` · `terms-i18n` · `format-helpers`

Each contract (signatures, semantics, wiring sites) is documented in the header of the
unit file that tests it.

## Coverage matrix

| Problem | Unit (jest/unit) | Integration (jest/integration) | E2E (cypress/e2e) |
|---|---|---|---|
| P-03 send-otp cooldown + attempts reset | otp-rate-limit.test.ts | otp-rate-limit.int.test.ts | — (API-only) |
| P-04 "omitir" never accepted | intent-parsers.test.ts | onboarding-spanish.int.test.ts | onboarding-spanish-intents.cy.ts |
| P-06 "Nuevo usuario" leaks outbound | email-i18n.test.ts | email-content.int.test.ts | outbound-email-content.cy.ts |
| P-07 accent-mangling title case | email-i18n.test.ts | email-content.int.test.ts | — |
| P-08 contradictory landing offers | landing-copy.test.ts | landing-pages.int.test.ts (incl. proposed `GET /api/admin/landing-offers`) | landing-consistency.cy.ts |
| P-09 success reported on failed send | send-result.test.ts | error-contracts.int.test.ts (backend half is already honest — contract-pin) | invoice-send-honesty.cy.ts |
| P-10 no LLM chat timeout | assistant-contracts.test.ts | assistant-flows.int.test.ts (documented skip — stub LLM) | assistant-experience.cy.ts |
| P-11 /q accepted state not persisted | public-doc-state.test.ts | public-doc-state.int.test.ts | public-doc-state.cy.ts |
| P-12 /i and /co English-only | public-lang.test.ts | seo-plumbing.int.test.ts | public-money-pages-i18n.cy.ts |
| P-13 contract "Para: —" | public-doc-state.test.ts | public-doc-state.int.test.ts | public-doc-state.cy.ts |
| P-14 first quote misreported WON | pipeline-stats.test.ts | pipeline-stats.int.test.ts | dashboard-stats-truth.cy.ts |
| P-15 sample quote pollutes stats | pipeline-stats.test.ts | pipeline-stats.int.test.ts | dashboard-stats-truth.cy.ts |
| P-16 rotor article agreement | landing-copy.test.ts | — | — (unit pins grammar) |
| P-17 root header broken @390px | — | — | landing-mobile-390.cy.ts |
| P-18 mashed language toggle | — | — | landing-mobile-390.cy.ts |
| P-19 EN hero showcase + SSR flash | — | landing-pages.int.test.ts | landing-consistency.cy.ts |
| P-20 identical starter-chip replies | assistant-contracts.test.ts | assistant-flows.int.test.ts (documented skip — chips are client-side) | assistant-experience.cy.ts |
| P-21 terminology whiplash at send | assistant-contracts.test.ts (dict half) | — | assistant-experience.cy.ts |
| P-22 mobile history / lost mid-flow | — | — | assistant-experience.cy.ts |
| P-23 chat doesn't understand "sí" | intent-parsers.test.ts | onboarding-spanish.int.test.ts | onboarding-spanish-intents.cy.ts |
| P-24 choose-a-version mechanics | — | — | assistant-experience.cy.ts |
| P-25 EN terms in ES contracts | assistant-contracts.test.ts | — | assistant-experience.cy.ts |
| P-26 "English out" fails in preview | — | assistant-flows.int.test.ts (documented skip — stub echo) | assistant-experience.cy.ts |
| P-27 SMS wrong-language job name | sms-i18n.test.ts | sms-content.int.test.ts | outbound-sms-content.cy.ts |
| P-28 en-US / raw ISO dates in ES docs | email-i18n.test.ts | email-content.int.test.ts | — |
| P-29 "Estado: Sent" | email-i18n.test.ts | email-content.int.test.ts | — |
| P-30 "Hola hola," SMS | sms-i18n.test.ts | sms-content.int.test.ts | outbound-sms-content.cy.ts |
| P-31 /invoices detail panel defects | — | — | invoice-detail-panel.cy.ts |
| P-32 self-notifications as receipts | receipts-and-adjustments.test.ts | invoice-integrity.int.test.ts | invoice-detail-panel.cy.ts |
| P-33 ES post-onboarding payoff | — | — | onboarding-spanish-intents.cy.ts |
| P-34 broken Spanish on /clients | i18n-dictionary-consistency.test.ts + format-helpers.test.ts | — | clients-page-quality.cy.ts |
| P-35 auth/not-found serialize as 500 | — | error-contracts.int.test.ts | session-expiry-errors.cy.ts |
| P-36 contradictory money numbers | pipeline-stats.test.ts | — | dashboard-stats-truth.cy.ts |
| P-37 empty-state hero over real data | — | — | dashboard-stats-truth.cy.ts |
| P-38 autocomplete ignores state | — | — | signup-wizard-gaps.cy.ts |
| P-39 /verify "Editar" → wrong page | — | — | signup-wizard-gaps.cy.ts |
| P-40 drawn signature never shown | public-doc-state.test.ts | public-doc-state.int.test.ts | public-doc-state.cy.ts |
| P-41 adjustment integrity gaps | receipts-and-adjustments.test.ts | invoice-integrity.int.test.ts | invoice-detail-panel.cy.ts |
| P-42 three save models in settings | — | — | settings-save-model.cy.ts |
| P-43 Depósito vs Anticipo | i18n-dictionary-consistency.test.ts | — | — |
| P-44 ES subject word order | email-i18n.test.ts | email-content.int.test.ts | outbound-email-content.cy.ts |
| P-45 preview vs contract label drift | i18n-dictionary-consistency.test.ts | — | — |
| P-46 EN naming drift + Title Case | i18n-dictionary-consistency.test.ts | — | clients-page-quality.cy.ts |
| P-47 same-page ES label drift | i18n-dictionary-consistency.test.ts | — | — |
| P-48 "días vencido" agreement | i18n-dictionary-consistency.test.ts (two sub-items already fixed in dicts — dropped) | — | — |
| P-49 lowercase invoice SMS | sms-i18n.test.ts | sms-content.int.test.ts | — |
| P-50 accepted-alert inconsistencies | sms-i18n.test.ts | sms-content.int.test.ts | — |
| P-51 "ea" leaks into ES emails | email-i18n.test.ts | email-content.int.test.ts | — |
| P-52 "Bossie" vs "PM Assistant" | intent-parsers.test.ts (dict scan) | — | onboarding-spanish-intents.cy.ts |
| P-53 Shift hint on mobile | assistant-contracts.test.ts (dict already clean — documented skip) | — | assistant-experience.cy.ts |
| P-54 wizard step 4 no Back/Skip | — | — | signup-wizard-gaps.cy.ts |
| P-55 robots.txt / sitemap.xml 404 | — | seo-plumbing.int.test.ts | seo-pwa-plumbing.cy.ts |
| P-56 unstyled plaintext 404 | — | seo-plumbing.int.test.ts | seo-pwa-plumbing.cy.ts |
| P-57 no theme-color / manifest | — | seo-plumbing.int.test.ts | seo-pwa-plumbing.cy.ts |
| P-58 /q overflow @390px | — | — | seo-pwa-plumbing.cy.ts |
| P-59 frozen-language activity feed | format-helpers.test.ts | activity-feed-lang.int.test.ts | chrome-misc-polish.cy.ts |
| P-60 /landing ES typos | landing-copy.test.ts (typos live in lang/es.json `promoLanding.*`, not landing-scripts.js) | — | landing-consistency.cy.ts |
| P-61 "perdidasfaltan" run-on | i18n-dictionary-consistency.test.ts | — | — |
| P-62 no @media print on /c | — | — | seo-pwa-plumbing.cy.ts (a print block exists but only hides the brand strip) |
| P-63 signed /c gaps (PDF, footer, /q buttons) | public-doc-state.test.ts | public-doc-state.int.test.ts | public-doc-state.cy.ts |
| P-64 phone rendering / address claim | format-helpers.test.ts | — | clients-page-quality.cy.ts |
| P-65 chrome misc (html lang, /test, DELETE…) | i18n-dictionary-consistency.test.ts + format-helpers.test.ts | — | chrome-misc-polish.cy.ts |
| P-66 1.3MB logo-email.png | format-helpers.test.ts (fs size < 300KB) | — | — |
| P-67 console noise on login/logout | — | — | session-expiry-errors.cy.ts |

## Honesty notes (tests that could NOT be red were not faked)

- **P-09**: the backend already returns a machine-readable failure (`200 {ok:false, reason}`)
  and records nothing as sent — that half is a labeled contract-pin (green); the red halves
  are the FE surfaces (unit + e2e).
- **P-10 / P-20 / P-26 integration**: under the stub LLM there is no honest server-side red
  (chips are client-side flows; the stub answers in ms; translate echoes). Documented
  `it.skip`s with curl evidence; the red lives in unit + e2e.
- **P-48 / P-53 / P-62**: sub-items that are already fixed in the live dicts/CSS were probed
  and dropped or narrowed so nothing passes by accident — each such decision is noted in
  the test file.

## Environment notes for the green agent

- Backend boot without `OPENAI_API_KEY`: `cd backend && PORT=4280 APP_URL=http://localhost:5280
  deno run -A --env-file=../.env --unstable-kv bootstrap/mod.ts` (unset `AGENTS_LLM_CLIENT`
  → stub client). Frontend: `cd front-end && PORT=5280 BACKEND_URL=http://localhost:4280
  deno run -A --env-file=../.env npm:vite`.
- The email HTML body is NOT logged to `/messages` (only subject + a stub content line) —
  several email-content assertions therefore also require exposing the rendered copy on the
  comms log (see email-content.int.test.ts header).
- The signed-confirm SMS is currently sent without `LogPaperworkMessage` — P-30's tests
  require it logged (channel `"text"`, contract paperworkId).
- Each subagent report's endpoint/shape discoveries are summarized in the corresponding
  test-file headers.

## Green-phase outcome (2026-08-18)

All problem suites pass. Final boards on the merged main:

- **Jest**: 356 passing / 5 documented skips / 1 failure — `professionalize.int.test.ts`
  ("keeps the scope faithful") requires a REAL LLM: it asserts content quality that the
  dev stub client ("(stub) …" echoes) can never produce. It predates this problems.md
  cycle and passes wherever `OPENAI_API_KEY` is set. The 5 skips are evidence-backed
  `it.skip`s inside `assistant-flows.int.test.ts`/`assistant-contracts.test.ts` documenting
  assertions that are unfalsifiable under the stub LLM (their behavior is covered by the
  unit + e2e layers).
- **Cypress**: all 39 specs, 200 passing / 1 intentional pending / 0 failing.

Environment notes:

- **Repeatability**: several specs (pre-existing and new) use FIXED phone numbers and
  assume either a clean slate or a legacy English user (the app is Spanish-first for
  fresh signups). Before a full `cypress run` on a long-lived dev KV, run
  `cd backend && deno run -A --unstable-kv scripts/dev-reset-e2e-fixtures.ts`
  (dev stack must be up) — it wipes the accumulator phones and re-seeds the legacy EN
  users. CI/fresh environments only need the seeding half, which it also does.
- **Pre-existing spec update (disclosed)**: `dashboard-assistant-access.cy.ts` pinned the
  old sidebar wording via three `/clients/i` label assertions; the frozen P-46 requirement
  ("Customers" everywhere, canonical `/customers` URL) legitimately changed that wording,
  so those three pins were updated to `/customers/i`. No problems.md spec was modified.
- Cypress runs headless in the dev container: `XDG_CONFIG_HOME=<scratch> xvfb-run -a npx
  cypress run` (binary via `npx cypress install`).
