# TDD plan — Quote Flow Tasks (raw-plan.pdf, pages 2–20)

Red-first test suite for every open problem/todo in `raw-plan.pdf` (the
"Quote Flow Tasks" deck). Page 21 is the "COMPLETED TASKS" divider — nothing
after it is covered. **No implementation code exists for these yet by design**:
unit tests import from `shared/quote-flow/*` modules that the green phase will
create; integration + e2e tests pin the desired API/UI contracts.

Layers:
- **Unit (Jest)** — `jest/unit/*.test.ts`. Pure logic, no network. Import from
  `shared/quote-flow/<mod>` (extensionless — same files will be imported by
  Deno with `.ts`). Keep those modules dependency-free.
- **Integration (Jest)** — `jest/integration/*.int.test.ts`. Real HTTP against
  the dev stack (`deno task serve`; frontend proxy `:5280/api` → backend
  `:4280`), master OTP `000000` auth.
- **E2E (Cypress)** — `cypress/e2e/*.cy.ts`. Real browser flows. New/unbuilt UI
  is addressed by `data-cy` contract selectors (listed per spec below) — the
  green phase must add them.

## PDF item → test map

| # | Page | Item (paraphrased) | Unit | Integration | E2E |
|---|------|--------------------|------|-------------|-----|
| 1 | 2, 8 | Go Back button on every wizard/task step; Job Details not editable without it; data preserved on back | `wizard-nav.test.ts` | `wizard-back.int.test.ts` | `quotes-wizard-navigation.cy.ts` |
| 2 | 3 | Once the invoice exists (flow complete), Go Back exits to the Dashboard | `wizard-nav.test.ts` | — | `quotes-wizard-navigation.cy.ts` |
| 3 | 4 | "Why is contracts back?" — no separate Contracts nav section (folded into Quote + Agreement) | — | — | `dashboard-navigation.cy.ts` |
| 4 | 5 | "Write it myself" needs a **Professionalize that** button; result must be reviewable (accept or edit), never auto-applied | `professionalize.test.ts` | `professionalize.int.test.ts` | `quotes-professionalize.cy.ts` |
| 5 | 6 | Invoice parity: all quote info except the Terms list; **no signature block**; link to the signed quote when one exists; editable | `invoice-from-quote.test.ts` | `invoice-parity.int.test.ts` | `invoice-parity.cy.ts` |
| 6 | 7 | Business name field on the wizard "Who is this for?" step | `wizard-steps.test.ts` | — | `quotes-wizard-navigation.cy.ts` |
| 7 | 8 | "My Assistant" reachable at top of dashboard on mobile WITHOUT the hamburger | — | — | `dashboard-assistant-access.cy.ts` |
| 8 | 8 | Completion Text + Email after quote sent / signed | — | `notifications.int.test.ts` | `public-completion-notify.cy.ts` |
| 9 | 8, 19 | Mobile friendly / flawless mobile view | — | — | `responsive-mobile.cy.ts` |
| 10 | 8 | PM Assistant hamburger menu icon does not work (bug) | — | — | `dashboard-assistant-access.cy.ts` |
| 11 | 8 | Settings editable: Mailing Address, Insurance upload, Tax W-9 | — | `settings.int.test.ts` | `settings-editable.cy.ts` |
| 12 | 8 | Job Name: summarize job details into ≤ 3 words; consistent platform-wide | `job-name.test.ts` | `job-name.int.test.ts` | `quotes-job-name.cy.ts` |
| 13 | 9 | QuickBooks-style sidebar minimize (hamburger + collapse arrow); same pattern for PM Assistant conversations panel | — | — | `dashboard-assistant-access.cy.ts` |
| 14 | 10 | Status badge lifecycle: Draft → Sent → Viewed → Approved (on sign) | `quote-status.test.ts` | `quote-lifecycle.int.test.ts` | `quotes-status-badges.cy.ts` |
| 15 | 11 | Copy Link must give the FULL quote, not the simple version | `share-link.test.ts` | — | `quotes-copy-link.cy.ts` |
| 16 | 12 | Contract doc layout (Final.docx): jobName title, plain-English deal section, job details, contract value | — | — | `public-contract-signature.cy.ts` |
| 17 | 13 | Email SUBJECT: no quotation marks around the job name | `email-subject.test.ts` | `notifications.int.test.ts` | — |
| 18 | 14 | Signature block: contractor side shows business name, "By: <name>", date; customer side "Sign & type name below"; "By signing below, <client> agrees to everything above." | `signature-block.test.ts` | — | `public-contract-signature.cy.ts` |
| 19 | 15 | SMS template: "Hi [Customer], this is [Contractor] from [Business]. Your Quote + Agreement for [Job Name] is ready: [LINK] …" | `sms-template.test.ts` | — | — |
| 20 | 16 | Build "I know the job, help me price it": job details → follow-up questions → confirm details → 3 pricing options + custom → rest of steps | — | — | `quotes-help-me-price.cy.ts` |
| 21 | 17 | "Just give me a quick quote" — product decision OPEN (how does it differ?) | — | — | `quotes-help-me-price.cy.ts` (`it.skip` placeholder) |
| 22 | 18 | Invoices broken; adjust via **discount** or **change order**; change order triggers a NEW approval link the customer must approve | `invoice-adjustments.test.ts` | `invoice-adjust.int.test.ts` | `invoice-adjustments.cy.ts` |
| 23 | 19 | Login button at top of landing page → clean login component, same OTP flow | — | — | `auth-landing-login.cy.ts` |
| 24 | 19 | Spanish l10n across the quote flow (MX/South American/Latino dialects) | — | — | `i18n-spanish.cy.ts` |
| 25 | 20 | Pricing — **superseded 2026-08-31** by Hans's "PM – Meeting Recap & Action Items August 27-28, 2026": Monster Free $0/mo (unlimited invoices, max 5 quotes/mo), Monster $99/mo, Monster Assist $199/mo, Monster Projects (custom, no figure shown); Monster Assist Plus ($399–$599) HIDDEN (phone/onboarding upsell); NO percentage fee | `pricing-plans.test.ts` | — | `landing-pricing.cy.ts` |

## Contract selectors the green phase must add (`data-cy`)

- `wizard-back` — back control rendered on every wizard step after the first
- `professionalize-btn`, `professionalize-proposal`, `professionalize-accept`, `professionalize-edit`
- `quote-status-badge` (on quote card/list; values DRAFT/SENT/VIEWED/APPROVED or localized equivalents)
- `invoice-doc` (the rendered public invoice document container), `invoice-signed-quote-link`, `invoice-edit`
- `invoice-discount-btn`, `invoice-change-order-btn`, `change-order-approval-link`
- `pricing-option` (×3) and `pricing-option-custom`; `confirm-details`
- `sidebar-collapse` (rail collapse arrow), `sidebar-expand` (hamburger on the collapsed rail), `asst-threads-collapse` + `asst-threads-expand`
- `mobile-menu` (assistant mobile hamburger; existing hamburger classes also accepted)
- `landing-login` (landing top nav), `pricing-plan` (one per landing plan card), `settings-mailing-address`, `settings-insurance-upload`, `settings-w9-upload`
- `assistant-cta` (dashboard-top My Assistant entry, visible on mobile without the hamburger)
- `wizard-business-name` (business name input on "Who is this for?")

## Routing + API contracts the green phase must honor/add

- **Deep-link**: `/quotes?open=<id>` and `/invoices?open=<id>` open that
  document's detail view (new contract — several e2e specs rely on it).
- **Assistant deep-link**: `/assistant?c=<conversationId>` re-opens that
  conversation.
- **Shipped vocabulary is authoritative** (tests were aligned to it): invoice
  money = `amount` (integer cents) + `discountCents` (clamps at zero, never
  negative); change orders = `{ description, deltaAmountCents }`, approval
  page = `/co/<id>`; SMS channel in the message log = `"text"`.
- **Extension**: `POST /agents/job-details/professionalize` additionally
  accepts `{ details }` (multi-line) returning `{ items: string[] }`; the
  legacy `{ text } → { text }` shape keeps working.
- **New derivation**: `POST /invoices { quoteId }` builds the invoice from
  the quote (parity minus terms/signature); public invoice read exposes
  `signedQuoteUrl` when the chain's contract is signed.
- **Observability**: sent emails/texts are readable in the message log
  (`GET /messages`) with `channel` and (for email) `subject`.
- **Status semantics**: `viewed` is triggered by a NON-owner (cookie-less)
  public read; the owner's own views never advance the status.

## Known gaps (no test — tracked, not silently dropped)

- **p10 "Refer to Quote & Agreement - Preview.docx"** and **p12 Final.docx**:
  the .docx files are not in the repo; only what the slide screenshots show
  is pinned (title, plain-English, parties/effective line, DESCRIPTION/AMOUNT
  table, value block, sign section). The docx internals are untestable until
  the files land.
- **p13 email BODY anatomy** (greeting, WHAT HAPPENS NEXT, etc.): the slide's
  note only complains about the SUBJECT; the body template is not pinned.
- **p20 Starter blurb copy** ("legitimize your business…", "Quotes etc.") —
  slide-speak, not confirmed site copy; not asserted.
- **p19 dialect depth**: only a neutral-LatAm guard (no vosotros forms) is
  asserted; nothing distinguishes MX vs. South American vocabulary.
- **p20 pricing is superseded** (2026-08-31, Hans's "PM – Meeting Recap &
  Action Items August 27-28, 2026"): every tier bills monthly; the plan list
  lives in `shared/quote-flow/pricing-plans.ts` (`PUBLIC_PLANS` is what the
  pages render — Monster Assist Plus is a hidden upsell).

## Shared modules the green phase must create (`shared/quote-flow/`)

`job-name.ts`, `quote-status.ts`, `email-subject.ts`, `sms-template.ts`,
`professionalize.ts`, `invoice-from-quote.ts`, `invoice-adjustments.ts`,
`signature-block.ts`, `wizard-nav.ts`, `wizard-steps.ts`, `share-link.ts`,
`pricing-plans.ts`. Dependency-free TS so Deno (`.ts` import) and Jest
(extensionless) can both consume them. Exact expected APIs are pinned by the
unit tests.

## Deliberate interpretations (flag if wrong)

- **Page 3** is read as a REQUIREMENT (back at the invoice/final stage exits to
  the dashboard because there is nothing left to step back through), matching
  the universal-back contract in `AsstChat.tsx:872`.
- **Page 17** is an open product question — captured as a skipped placeholder,
  not an invented spec.
- **"Unicorn"** (pages 6/18) is read as the customer/client — the party who
  must approve a change order via the new public link.
- **Page 20 pricing** applies to the plans/pricing surface on the landing
  pages; the deck's tiers were replaced on 2026-08-31 (see row 25).
