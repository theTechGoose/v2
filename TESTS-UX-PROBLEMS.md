# TESTS-UX-PROBLEMS — red TDD suite for ux-problems.md

Every finding in `ux-problems.md` (UX-01…UX-23, UX-26…UX-41 — UX-24/25 do not exist in
that doc) has a failing (RED) test suite pinning the **desired** behavior. A green agent's
job is to make these pass **without editing the tests**.

Harness is identical to TESTS-PROBLEMS.md (read it first — same conventions, same honesty
rules). All new files are namespaced `ux-*`; **no P-\* suite, app source, shared module,
dictionary, or config was modified**.

- **Unit** — `cd jest && npx jest --selectProjects unit`. Pure logic. New contracts import
  from `shared/quote-flow/<module>` — missing modules/exports are the intended red. Each
  unit file's header documents the exact export contract and the prod `file:line` wiring
  sites (all verified by reading the source).
- **Integration** — `cd jest && npx jest --selectProjects integration`. Real HTTP against
  the dev stack. Every endpoint was curl-probed before the assertion was written; probe
  evidence lives in the file headers. Verified red against the live stack on 2026-08-19.
- **E2E** — `cypress/e2e/ux-*.cy.ts` (19 new specs). Cypress cannot execute in this dev
  container; every spec is grounded selector-by-selector in the island/route source
  (cited in-file), typechecks clean (`cd cypress && npx tsc --noEmit` → 0 errors), and
  the layout findings (UX-01/09/10/11) were live-measured via Playwright at 390×844
  before pinning (numbers recorded in the spec headers).

Test-title convention: every `describe`/`it` starts with its finding id (`"UX-07: …"`).
Phone blocks `+1512555{6000..6699}` are reserved for this suite (disjoint from the P-\*
blocks `2000..3199`): 60xx slice A (landing/OTP/wizard), 61xx B (first-win), 62xx C
(outbound), 63xx D (job-name), 64xx E (assistant), 65xx F (pages/chrome), 66xx G
(contract/billing).

## Verified boards (2026-08-19, live stack)

- **Unit**: 25 legacy suites green · 11 `ux-*` suites red (74 red tests, plus labeled
  green contract-pins).
- **Integration**: 18 legacy suites green · 7 `ux-*` suites red (18 red tests). The only
  non-`ux` failure is the pre-existing `professionalize.int.test.ts` (real-LLM-only,
  documented in TESTS-PROBLEMS.md — predates this cycle).
- **Cypress**: full tree typechecks clean; legacy specs untouched.

## New shared/quote-flow contracts (to be created by the green agent)

New modules (missing-module red):

- `otp-cooldown-ux` — `classifySendOtpResponse(status, body)` → sent/cooldown(+retryAfterSeconds)/failed; `cooldownMessage(lang, secondsLeft)`. (UX-33)
- `quick-quote-prefill` — `extractPriceCents`, `extractCustomerName`, `extractQuickQuotePrefill`, `acceptedJobChipLabel`. (UX-04/32)
- `thread-title` — `threadTitle({jobName, customerName, title}, lang)` → "«job» · «customer»". (UX-14)
- `comms-language` — `resolveCommsLanguage({override, identityCommsLanguage})` — one resolution for every channel/doc type. (UX-28)
- `milestone-reconcile` — `billedTotalCents(existing)`, `reconcileMilestones(planned, total, existing)` — bill only the unbilled remainder; fully paid → `[]`. (UX-36)
- `summary-clamp` — `clampSummary(raw, maxWords=8)` — ellipsis on cut, idempotent. (UX-18)

Extensions to existing modules (missing-export / failed-assertion red):

- `job-name.ts` — `summarizeJobName(details, lang?: "en"|"es")`: ES connectors lowercase mid-name, never first or last; sentence case; accent-safe. EN path frozen green by the legacy suite. (UX-05/26c/29/41)
- `outbound-identity.ts` — `outboundSenderFirstName(userName)`, `senderIdentityRefusal({userName, businessName})` — the ONE pre-dispatch gate every outbound path (incl. the assistant's `send-contract` → `SendPaperworkSms`) must pass. (UX-26)
- `pipeline-stats.ts` — `PipelineAggregate.wonCents` (the "ganado / por facturar" bucket) and `resolveJobCustomerId(quote, contract)`; REST: `GET /analytics/dashboard` gains `wonValueCents`. (UX-02)
- `public-doc-state.ts` — `pendingSignature: boolean` + `acceptedEvidence {at, by, via}` derived from quote-acceptance fields, accepting both fix shapes (accept marks contract signed, or /c renders already-accepted). (UX-37)
- `format-helpers.ts` — `formatShortDate(iso, lang)`: en "Aug 25" / es "25 ago", ES months from the dict table. (UX-38)

Each contract's exact signatures, semantics, and verified wiring `file:line` sites are in
the corresponding unit-file header.

## Coverage matrix

| Finding | Unit (jest/unit) | Integration (jest/integration) | E2E (cypress/e2e) |
|---|---|---|---|
| UX-01 signup card clipped @390 | — | — | ux-landing-mobile.cy.ts |
| UX-02 first win invisible everywhere | ux-first-win.test.ts | ux-first-win.int.test.ts | ux-first-win-visibility.cy.ts |
| UX-03 contradictory send confirmation | — | — | ux-send-moment.cy.ts |
| UX-04 assistant deaf to typed price/name | ux-quick-quote-prefill.test.ts | — | ux-assistant-prefill.cy.ts |
| UX-05 ES stopword Title-Casing → jobName | ux-job-name-es.test.ts | ux-job-name.int.test.ts | — |
| UX-06 EN preview silently keeps ES | — | — | ux-assistant-i18n.cy.ts (500-intercept made deterministic) |
| UX-07 coachmark after mastery / stuck | — | — | ux-coachmark.cy.ts |
| UX-08 accepted quote dead end on /quotes | — | — | ux-quotes-page.cy.ts |
| UX-09 activity header broken @390 | — | — | ux-dashboard-mobile-390.cy.ts |
| UX-10 "Paso 1 de 10" march | — | — | ux-wizard-steps.cy.ts (honest disjunction: ≤6 counted OR "opcional" framing) |
| UX-11 step-4 double primary | — | — | ux-wizard-steps.cy.ts |
| UX-12 English divider chips in ES chat | ux-assistant-i18n.test.ts (lang-plumbing red) | — | ux-assistant-i18n.cy.ts |
| UX-13 customer-step nits | — | — | ux-assistant-i18n.cy.ts |
| UX-14 unhelpful thread list / ⌘N on mobile | ux-assistant-i18n.test.ts | — | ux-assistant-i18n.cy.ts |
| UX-15 raw phones on doc preview | ux-page-copy.test.ts (labeled contract-pin — formatter already correct) | — | ux-doc-preview.cy.ts |
| UX-16 EN tab title on ES /quotes | ux-page-copy.test.ts (`quotesPage.docTitle`) | — | ux-quotes-page.cy.ts |
| UX-17 sample-quote numbers story | — | — | ux-quotes-page.cy.ts |
| UX-18 truncation without ellipsis | ux-page-copy.test.ts (summary-clamp) | — | ux-quotes-page.cy.ts |
| UX-19 "Haz clic en una casilla" | ux-assistant-i18n.test.ts | — | ux-assistant-i18n.cy.ts |
| UX-20 feed/KPI polish | — | — | ux-chrome-polish.cy.ts |
| UX-21 desktop/drawer artifacts | — | — | ux-chrome-polish.cy.ts |
| UX-22 thin immediate accept confirmation | — | — | ux-post-accept-confirmation.cy.ts |
| UX-23 invisible "Exportar CSV" ghost | — | — | ux-invoice-review.cy.ts (hidden-or-≥3:1 contrast) |
| UX-26 assistant bypasses identity gate | ux-outbound-gate.test.ts; casing half: ux-job-name-es.test.ts | ux-outbound-gate.int.test.ts (+ ux-job-name.int.test.ts) | ux-skip-user-identity.cy.ts (De-block affordance) |
| UX-27 placeholder treated as real name | — | — | ux-skip-user-identity.cy.ts |
| UX-28 inconsistent outbound language | ux-comms-language.test.ts | ux-comms-language.int.test.ts | — |
| UX-29 "El patio de" jobName | ux-job-name-es.test.ts | ux-job-name.int.test.ts | — |
| UX-30 promised receipt never sent | — | ux-payment-receipt.int.test.ts | — |
| UX-31 invoice saved without review, due today | — | — | ux-invoice-review.cy.ts |
| UX-32 facturar ignores known context | ux-quick-quote-prefill.test.ts | — | ux-assistant-prefill.cy.ts |
| UX-33 cooldown surfaces as generic failure | ux-otp-cooldown-ux.test.ts | ux-otp-cooldown.int.test.ts | ux-otp-cooldown.cy.ts |
| UX-34 "Haz clic aquí" dropdown trigger | ux-assistant-i18n.test.ts | — | ux-assistant-i18n.cy.ts |
| UX-35 small-issue cluster | ux-page-copy.test.ts (/q agreement) | — | ux-money-pages-polish.cy.ts (pages) + ux-assistant-i18n.cy.ts (assistant bullets) |
| UX-36 sign-after-paid double-bills | ux-milestone-reconcile.test.ts | ux-contract-billing.int.test.ts | ux-contract-double-sign.cy.ts |
| UX-37 two signature ceremonies, one deal | ux-doc-model.test.ts | ux-contract-billing.int.test.ts | ux-contract-double-sign.cy.ts |
| UX-38 en-US dates on ES /c + hero | ux-es-dates.test.ts | — | ux-c-page-i18n.cy.ts |
| UX-39 email promise to email-less customer | — | — | ux-c-page-i18n.cy.ts |
| UX-40 English /c tab title | — | — | ux-c-page-i18n.cy.ts |
| UX-41 help-me-price nits | casing: ux-job-name-es.test.ts | ux-job-name.int.test.ts | ux-help-me-price.cy.ts (affordance/overlap) |

## Root causes proven while writing the reds (evidence in file headers)

- **UX-02**: the draft contract does NOT disqualify the job (probe: API-seeded accepted
  quote with a draft contract → `GET /jobs` returns it). The real gap: the assistant's
  SMS-only `send-contract` path never backfills `quote.customerId`/sentAt
  (`send-contract/mod.ts:116-130` gates on `wantEmail`), so `list-active-jobs/mod.ts:97-98`
  drops the job and the value lands in no bucket.
- **UX-26**: the P-06 guard lives only on the paperwork controller
  (`paperwork-email-controller/mod.ts:71-93`); `send-contract/mod.ts:100-110` dispatches
  `SendPaperworkSms` directly. Reproduced live: `"Hi Pedro, this is Nuevo.…"`.
- **UX-30**: `confirm-payment/mod.ts:104-158` completes claim→confirm→paid with ZERO
  comms-log rows — the promised receipt has no dispatch site.
- **UX-33**: the backend already returns `429 {ok:false, error:"cooldown",
  retryAfterSeconds}` AND a `Retry-After` header — but the FE proxy
  (`front-end/routes/api/auth/send-otp.ts:22-25`) rebuilds headers and strips
  `Retry-After`, and `landing-scripts.js:827-853` collapses every `!res.ok` to the
  generic failure.
- **UX-36**: `send-signed-confirmation/mod.ts:136-185` creates the 50/50 milestone pair
  unconditionally on sign. Reproduced live: $3,700 deal, fully paid, then signed →
  invoices sum $7,400.

## Honesty notes (nothing passes or fails by accident)

- **Labeled green contract-pins** (frozen so the fix can't regress them): the 429 JSON
  cooldown shape (P-03), approved+draft-contract → "won" classification, `/jobs` with a
  customer-linked quote, `formatPhoneDisplay`, `formatLongDate` es/en, the
  controller-path identity refusal, `sb__toggle` aria-label, the /invoices modal's
  editable due date + the API's +30-day default (the UX-31 red is the assistant facturar
  path, which sends `dueDate: today` — `AsstChat.tsx:3139-3145`).
- **Stub-LLM handling**: no fake reds. Slice D proved polish/options run deterministic
  fallbacks under the stub (unparseable "(stub)" echo), so all job-name integration reds
  are deterministic. UX-06's translation-state red is made deterministic by intercepting
  the translate call with a 500 (P-26 precedent). The UX-28 reproduction uses the exact
  dispatches the audited user fired (assistant contract-text with `language:"es"` vs
  invoice-text), since the plain `/text` routes can't carry a language pick.
- **Narrowings** (documented in-file): UX-01 /verify narrowed to the `.verify-card`
  surface (the "3 LISTO" tracker measures in-bounds in isolation); UX-41's
  "role=button exists" would pass today — narrowed to the missing standard advance
  control in confirm mode; UX-35's toast/header garble and preview tint are not
  deterministically reproducible from source — pinned as labeled invariant guards; the
  "SALDO / Saldado" wording was dropped (any replacement copy would be an arbitrary pin);
  UX-14's ⌘N has no extractable pure contract (unconditional render) — e2e-only.
- **Two-shape pins** where ux-problems.md offers alternative fixes: UX-10 (≤6 counted
  steps OR "opcional" framing), UX-37 (accept marks contract signed OR /c renders
  already-accepted), UX-26(b) (De-block warning/edit affordance OR placeholder never
  shown), UX-26 int (refusal OR identity-complete send).

## Environment notes for the green agent

- Same stack/boot as TESTS-PROBLEMS.md (`deno task serve`, or the container's stub-LLM
  direct boot). Amounts are integer cents. `blackhole.postmarkapp.com` for emails.
- Before a full `cypress run` on a long-lived dev KV, run the fixture reset documented in
  TESTS-PROBLEMS.md; the UX suites additionally keep all state inside the
  `+1512555{6000..6699}` block. UX-36's cypress spec derives deal amounts from
  `Date.now()` so phantom milestone pairs from prior unfixed runs can't collide.
- `POST /quotes` requires `summary` (500 without it); quote-store derives `jobName` from
  it when absent (`quote-store/mod.ts:28-31`).
- The conversations list projection (`conversations-controller/mod.ts:40-45`) denormalizes
  neither `customerName` nor `jobName` — UX-14's thread-title fix needs the projection
  extended (probe-verified: a customer+quote-bound conversation lists `title: null`).
- Several e2e pins accept a semantically inevitable hook instead of an invented
  data-testid (e.g. the UX-02 create-invoice CTA = any anchor/button referencing the won
  quote/customer with invoice intent); each such pin documents its acceptance rule
  in-file.

## Green-phase outcome (2026-08-19)

All UX suites pass; no test file was modified. Final boards on the dev stack:

- **Jest**: 493 passing / 5 documented skips / 0 failures. All 11 `ux-*` unit
  suites and all 7 `ux-*` integration suites are green. The previously
  real-LLM-only `professionalize.int.test.ts` now passes under the stub too:
  ProfessionalizeBullet gained a scope-faithfulness gate + deterministic
  verb-phrase fallback (an LLM reply sharing no content word with the input
  bullet — the stub echo, a refusal, or an off-scope hallucination — is
  replaced by a deterministic rewrite that keeps every content word).
- **Cypress**: full suite (39 legacy + 19 `ux-*` = 58 specs), 278 passing /
  1 intentional pending / 0 failing.

Environment notes:

- **Harness fix (disclosed, not a test edit)**: `jest/jest.config.js` declared
  `testTimeout: 30_000` in per-project position, where jest silently ignores it
  (per-project ran on the 5s default — UX-36's intentional 8s green-path poll
  could never pass). The same value is now also declared at the root, where it
  applies.
- **Repeatability**: the `ux-*` cypress suites keep all state inside the
  `+1512555{6000..6699}` phone block but do not self-wipe, so on a long-lived
  dev KV a re-run inherits customers/quotes from the previous one (e.g. the
  assistant customer step then opens on the pick list instead of the create
  form). Run `backend/scripts/dev-reset-ux-phones.sh` (dev stack up; wipes the
  whole block via master-OTP login + `GET /me/wipe`) before a full run, along
  with the P-\* `dev-reset-e2e-fixtures.ts` documented in TESTS-PROBLEMS.md.
- **Cypress visibility quirk worth knowing**: a `position:fixed` overlay whose
  center is `pointer-events:none` is judged **not visible** by Cypress (its
  `elementFromPoint` probe falls through to the page). The UX-07 coachmark now
  carries a small centered `pointer-events:auto` dismiss hotspot so the
  overlay registers as the element at its own center while every other click
  still passes through to the app (and dismisses via the document-level
  pointerdown/click/Escape listeners).
