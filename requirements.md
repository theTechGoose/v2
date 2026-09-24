# Requirements

Append-only. One entry per requirement; ids come from `~/.claude/tools/req-next`. Every test names its `REQ` id.

## REQ-001 — 0.A Is prod on the stub LLM? Make the silent stub fall-through impossible
**Source:** new-working-issues.md NW-05 / NW-11 / NW-12 (PDF p4, p20, p21), 2026-09-18
**Requirement (client's words):** "The AI must never echo the user's raw input back as the suggested description. … Until this is solved we cannot produce even simple quotes and invoices." — the production entry must fail loudly at boot when `AGENTS_LLM_CLIENT` / `TRANSCRIPTION_CLIENT` is not `openai`, instead of silently binding the stub that produces the echo.
**Tests:** unit (Deno) `backend/src/agents/domain/business/llm/select/test.ts` · integration `n/a — env selection happens at module load, before any HTTP` · e2e `n/a — same`

## REQ-002 — 1.1 NW-01 Landing language toggle: Spanish button first
**Source:** new-working-issues.md NW-01 (PDF p2), 2026-09-18
**Requirement (client's words):** "Default language must be Spanish. The toggle at the top should read 'Yo hablo Espanol | I speak English', with 'Yo hablo Espanol' selected by default."
**Tests:** unit `n/a — pure markup order, no logic` · integration `jest/integration/landing-pages.int.test.ts` ("REQ-002 NW-01 …") · e2e `cypress/e2e/landing-lang-toggle.cy.ts`

## REQ-003 — 1.2 NW-10 A quote is born `draft`, not `sent`
**Source:** new-working-issues.md NW-10 (PDF p8), 2026-09-18
**Requirement (client's words):** "The Quote + Agreement card shows a 'SENT' badge in the top right before I have actually sent it." — a quote is created as a draft; only an actual dispatch (email, text, or the assistant's send) flips it to sent and stamps `sentAt`.
**Tests:** unit `n/a — no pure logic; jest/unit/quote-status.test.ts already pins the lifecycle` · integration `jest/integration/quote-lifecycle.int.test.ts` ("REQ-003 NW-10 …") + backend `backend/src/paperwork/entrypoints/paperwork-email-controller/e2e.test.ts` ("REQ-003 … /text stamps") · e2e `cypress/e2e/quotes-status-badges.cy.ts` ("REQ-003 NW-10 the price flow creates a draft")

## REQ-004 — 1.3 NW-20 Back from the customer step returns to the price step
**Source:** new-working-issues.md NW-20 (PDF p31), 2026-09-18
**Requirement (client's words):** "Back button fails after you enter the price and go to the customer step. Hitting back takes you to the dashboard." — on the price-panel path, the header back at the customer step rewinds to the price step.
**Tests:** unit `n/a — resolver contract unchanged (jest/unit/assistant-back.test.ts)` · integration `n/a — browser state` · e2e `cypress/e2e/ux-assistant-single-back.cy.ts` ("REQ-004 NW-20 …")

## REQ-005 — 1.4 NW-19 Back works on the chat → "Lock it in" → terms path
**Source:** new-working-issues.md NW-19 (PDF p13), 2026-09-18
**Requirement (client's words):** "Fix the Go Back button for all of the tasks." — from the wizard's first question reached via chat ("Lock it in" → "Ready" CTA), back returns to the action card instead of exiting to the dashboard.
**Tests:** unit `jest/unit/assistant-back.test.ts` ("REQ-005 …") · integration backend `backend/src/agents/domain/coordinators/rewind-wizard/int.test.ts` + `jest/integration/assistant-back.int.test.ts` ("REQ-005 …") · e2e `n/a — the action card only comes from the live LLM; not deterministic under the stub. Verified by hand with a real key (see commit).`

## REQ-006 — 1.5 NW-19b Job Details is editable on the review card
**Source:** new-working-issues.md NW-19 (PDF p13) + "Make the Toilet Replacement job editable" (p56), 2026-09-18
**Requirement (client's words):** "Job Details is not editable on the review card, so they need a back button." / "Make the Toilet Replacement job editable." — the review card's Job Details section gets an edit control that reopens the job picker; the pick updates the card.
**Tests:** unit `n/a — component wiring; the picker itself is covered by quotes-professionalize.cy.ts` · integration `n/a — browser state` · e2e `cypress/e2e/ux-doc-preview.cy.ts` ("REQ-006 NW-19b …")

## REQ-007 — 1.6 NW-06 `/assistant` passes the `from` prop
**Source:** new-working-issues.md NW-06 (PDF p5), 2026-09-18
**Requirement (client's words):** "Make sure the 'From' block includes email and website when the Dragon has provided them. (Screenshot shows only name and phone.)" — a conversation started at the bare `/assistant` route shows the From block (business, name, phone, email) on the review card. Website is its own task (7.10).
**Tests:** unit `n/a — SSR prop plumbing` · integration `jest/integration/assistant-from-prop.int.test.ts` · e2e `cypress/e2e/ux-doc-preview.cy.ts` ("REQ-007 NW-06 …", live-LLM chat path)

## REQ-008 — 1.7 NW-47 The starter chip text is never captured as the contractor's name
**Source:** new-working-issues.md NW-47 (PDF p44), 2026-09-18
**Requirement (client's words):** (Screenshot shows the contractor name rendered as "I" / "I know the job" / "I from help me price it." — the flow label is being used as the sender name.) — emails/SMS never say "this is I from help me price it"; a first-turn message that reads as a job request / starter chip is never parsed as name + business.
**Tests:** unit (Deno) `backend/src/agents/domain/business/onboarding/test.ts` · integration (Deno) `backend/src/agents/domain/coordinators/handle-chat-message/int.test.ts` ("REQ-008 …") · e2e `n/a — backend-only logic; the outbound name gate is pinned by jest/unit/ux-outbound-gate.test.ts`

## REQ-009 — 1.8 NW-23 + NW-24 Start-date options and "Job completed" casing
**Source:** new-working-issues.md NW-23 (PDF p22) + NW-24 (PDF p23), 2026-09-18
**Requirement (client's words):** "'When does the job start?' has a 'Job Completed' option. Remove it and put 'Pick a date' in its place. Change 'Next Month' to 'Next month'." / "Change 'Job Completed' to 'Job completed' (lowercase c)." — old quotes that persisted "Job Completed" keep localizing correctly.
**Tests:** unit (Deno) `backend/src/agents/domain/business/terms-wizard-spec/test.ts` ("REQ-009 …") + jest `jest/unit/i18n-dictionary-consistency.test.ts` ("REQ-009 …") + Deno `backend/src/paperwork/domain/coordinators/render-quote-pdf/term-i18n.test.ts` (both PDF maps) · integration `n/a — the public quote page is client-rendered; the wizard payload is derived from the spec` · e2e `cypress/e2e/quotes-wizard-navigation.cy.ts` ("REQ-009 …") + `cypress/e2e/public-quote-term-casing.cy.ts` (old + new spelling on /q)

## REQ-010 — 1.9 NW-17 "Write it myself." gets its period and breathing room
**Source:** new-working-issues.md NW-17 (PDF p26), 2026-09-18
**Requirement (client's words):** "The chip at the bottom reads 'I know the job, help me price it.Write it myself'. Needs a space after the period and a period at the end of 'myself'." — the pill reads "✎ Write it myself." on its own line under the bubble.
**Tests:** unit `jest/unit/i18n-dictionary-consistency.test.ts` ("REQ-010 …") · integration `n/a — copy + CSS` · e2e `cypress/e2e/ux-help-me-price.cy.ts` ("REQ-010 …")

## REQ-011 — 1.10 NW-30 Invoice cards show the job name
**Source:** new-working-issues.md NW-30 (PDF p28), 2026-09-18
**Requirement (client's words):** "There is no real way to tell invoices apart other than customer name and price. There is a lot of wasted space that could show the job description." — each invoice card on /invoices shows the job name.
**Tests:** unit `n/a — projection of a field the API already returns` · integration `n/a — the API row is pinned by invoice-parity.int.test.ts` · e2e `cypress/e2e/invoice-card-job-name.cy.ts`

## REQ-012 — 1.11 NW-34 Phone numbers format as `(555) 123-4567` while typing
**Source:** new-working-issues.md NW-34 (PDF p30), 2026-09-18
**Requirement (client's words):** "Format phone numbers as (555) 123-4567 as they are typed. That is sexy." — every customer phone input (clients page, assistant customer step, assistant recovery card, invoices new-customer modal) masks as you type, with one shared formatter also used by the login/landing inputs.
**Tests:** unit `jest/unit/format-helpers.test.ts` ("REQ-012 …") · integration `n/a — pure front-end input formatting; the backend already accepts the masked form` · e2e `cypress/e2e/clients-page-quality.cy.ts` ("REQ-012 …")

## REQ-013 — 1.12 NW-36 Remove the "Who's on your books" chart
**Source:** new-working-issues.md NW-36 (PDF p32), 2026-09-18
**Requirement (client's words):** "Customers tab: remove the 'Who's on your books' chart (Property mgmt / Homeowners / Small biz / HOAs / Unsorted). We do not collect this data."
**Tests:** unit `n/a — removal of a component; dictionary parity is enforced by jest/unit/i18n-dictionary-consistency.test.ts` · integration `n/a — the backend endpoint stays (own e2e test)` · e2e `cypress/e2e/clients-page-quality.cy.ts` ("REQ-013 …")

## REQ-014 — 1.13 NW-54 "Terms and Conditions" heading on web + PDF
**Source:** new-working-issues.md NW-54 (PDF p62), 2026-09-18
**Requirement (client's words):** "Quote sent from the link: rename 'fine print, in plain english' to 'Terms and Conditions'." — the clause list is headed "Terms and Conditions" / "Términos y Condiciones" on the public quote page and on the PDF.
**Tests:** unit `jest/unit/i18n-dictionary-consistency.test.ts` ("REQ-014 …") · integration `n/a — copy` · e2e `cypress/e2e/public-quote-signature.cy.ts` ("REQ-014 …")

## REQ-015 — 1.14 Copy fixes from the "COMPLETED" half: governing-law tail, warranty labels, "Scope of Work"
**Source:** new-working-issues.md "COMPLETED" half (PDF p76-77, p80, p83), 2026-09-18
**Requirement (client's words):** "Warranty. No warranty / 6 months / 1 year / 2 years / Custom." · "Fixed language: 'This agreement is governed by the laws of the state where the work is performed, without regard to conflict of law rules.'" · required notices list item "Scope of Work" — and a persisted "1 year"/"2 years" warranty still localizes to Spanish on web + PDF.
**Tests:** unit `jest/unit/i18n-dictionary-consistency.test.ts` ("REQ-015 …") + Deno `backend/src/paperwork/domain/coordinators/render-quote-pdf/term-i18n.test.ts` ("REQ-015 …") · integration `n/a — copy + localization maps` · e2e `cypress/e2e/public-quote-signature.cy.ts` (REQ-014 describe extended for REQ-015)

## REQ-016 — 1.15 NW-14 side-find — Customer balance counts every unpaid invoice status
**Source:** new-working-issues.md NW-14 side-find (PDF p10), 2026-09-18
**Requirement (client's words):** "…the next page must show what they paid, what they owe…" — a customer's balance on /clients counts every invoice that is still owed (pending, sent, viewed, claimed), not only "pending"; paid, void, scheduled and draft invoices are not owed.
**Tests:** unit/integration (Deno) `backend/src/analytics/domain/coordinators/build-customer-cards/int.test.ts` ("REQ-016 …") · jest/e2e `n/a — backend aggregation`

## REQ-017 — Phase 2 NW-08 + NW-09 + NW-12 One pricing rewrite: Competitive / Market / Premium, ZIP-aware, labor + materials
**Source:** new-working-issues.md NW-08, NW-09 (PDF p7), NW-12 (PDF p21), 2026-09-18
**Requirement (client's words):** "The price tiers cannot be 'Basic / Standard / Premium' with descriptions like 'Basic paint job with minimal prep'… Use: Competitive — price-conscious bid when the job is straightforward and winning the work is the priority. Market — typical professional price for this type of work in your area. Premium — appropriate for urgent scheduling, difficult access, higher service expectations, or other job complexity." · "When calculating the price, are you using the Dragon's zip code?" · "For PM I don't know whether that includes materials. That is a vital question." — the three tiers are Competitive / Market / Premium with fixed localized labels, the model prices for the contractor's saved city/state/ZIP, prices include labor and materials and the screen says so.
**Tests:** unit `jest/unit/i18n-dictionary-consistency.test.ts` ("REQ-017 …") · integration (Deno) `backend/src/agents/domain/coordinators/suggest-prices/int.test.ts` + jest `jest/integration/suggest-prices.int.test.ts` · e2e `cypress/e2e/quotes-help-me-price.cy.ts` ("REQ-017 …")
**Model decision (Step 10):** the pricing call carries a per-request `model` override (new `LLMRequest.model`, honoured by `OpenAILLMClient`) and asks for `gpt-4o`; `SUGGEST_PRICES_MODEL` overrides it. Every other call keeps `OPENAI_MODEL` (default gpt-4o-mini). Live probe, client's 2,000 sq ft repaint with an Austin 78701 address: gpt-4o-mini $3,000 / $4,000 / $5,000 and $4,000 / $5,000 / $6,000; gpt-4o $5,500 / $6,500 / $7,500 and $6,500 / $8,000 / $9,500 (client's Claude/ChatGPT comparison: $6.5k–$16k).

## REQ-018 — 3.1 NW-27 + NW-32 "Payment received" on Out-for-payment / Overdue / Awaiting
**Source:** new-working-issues.md NW-27 (PDF p18) + NW-32 (PDF p29), 2026-09-18
**Requirement (client's words):** "How do you mark an invoice paid? We are not taking payments, so the client has to tell us payment has been received." / "If the Dragon marks an invoice as paid it should show up here. This is how payments are recorded." — an Out-for-payment / Overdue / Awaiting invoice offers "Payment received" → pick how they paid (all nine methods), amount (prefilled), date, optional reference → the invoice lands in Paid and the payment appears on /payments.
**Tests:** unit `n/a — UI wiring over an existing backend contract` · integration `jest/integration/payment-received.int.test.ts` (backend contract pin — green on arrival) · e2e `cypress/e2e/invoice-detail-panel.cy.ts` ("REQ-018 NW-27 …")

## REQ-019 — 3.2 NW-33 "Record a payment" and "Export" on /payments do real things
**Source:** new-working-issues.md NW-33 (PDF p29), 2026-09-18
**Requirement (client's words):** "'Record a payment' takes you to the quote/invoice chat. What is that button for?" — on /payments, "Record a payment" opens an in-page picker (unpaid invoice → how they paid → amount → date) that records the payment without leaving the page, and "Export this month" downloads this month's payments as a CSV.
**Tests:** unit `n/a — page wiring` · integration `jest/integration/invoice-export-month.int.test.ts` (month filter) · e2e `cypress/e2e/payments-record.cy.ts`

## REQ-020 — 3.3 NW-29 When an invoice becomes paid, the customer gets the invoice marked PAID
**Source:** new-working-issues.md NW-29 (PDF p28), 2026-09-18
**Requirement (client's words):** "When an invoice is paid it must also be emailed to the Unicorn with 'Paid' on it so everyone is on the same page." — every path that flips an invoice to paid (a recorded payment closing the balance, or confirming a customer claim) emails the customer the invoice stamped PAID (subject says Paid, no "Amount due"), logged in the comms trail.
**Tests:** unit `n/a` · integration (Deno) `backend/src/paperwork/domain/coordinators/send-paperwork-email/int.test.ts` + `compute-invoice-balance/int.test.ts` ("REQ-020 …") + jest `jest/integration/paid-invoice-email.int.test.ts` · e2e `n/a — email content`

## REQ-021 — 3.4 NW-31a "Awaiting confirmation" gets a real nudge; "Send nudge" uses the reminder cadence
**Source:** new-working-issues.md NW-31 (PDF p28), 2026-09-18
**Requirement (client's words):** "Awaiting confirmation — has an 'Ok I got it' button, but also needs a nudge button, because 'Ok I got it' marks it as paid." — the awaiting-confirmation card offers "Send a nudge", and both it and the overdue card's "Send nudge" post to the reminder cadence (`POST /cron/invoice-reminder`, day 3/7/14/30 by days overdue) instead of re-texting the whole invoice.
**Tests:** unit `n/a — page wiring over an existing backend cadence` · integration `jest/integration/invoice-nudge.int.test.ts` (backend contract pin — green on arrival) · e2e `cypress/e2e/invoice-detail-panel.cy.ts` ("REQ-021 …")

## REQ-022 — 3.5 NW-31c Upcoming invoices: pick a send date; nudge the Dragon when it is due
**Source:** new-working-issues.md NW-31 (PDF p28), 2026-09-18
**Requirement (client's words):** "Upcoming — needs a 'send it later' button with a date picker (if there is no start date, how do they know when to send the invoice?). Or a reminder text and email to the Dragon to approve that the job is done and send the final invoice." — a new invoice can be given a "send on" date (it lands in Upcoming), the date can be changed from the card, and on/after that date the contractor is nudged (a notification, once per day) to approve the job is done and send it.
**Tests:** unit `n/a — page wiring + one event mapping` · integration `jest/integration/invoice-schedule.int.test.ts` · e2e `cypress/e2e/invoice-schedule.cy.ts`

## REQ-023 — 4.1 NW-14 + NW-15 Picking an accepted job skips to a seeded review
**Source:** new-working-issues.md NW-14 (PDF p10) + NW-15 (PDF p11), 2026-09-18
**Requirement (client's words):** "If you select the invoice of an existing client, the next page must show what they paid, what they owe, the terms, etc." / "If I select an existing quote it should already know who the customer is. (Screenshot: it asks 'What's the price?' again.)" — picking an accepted job in "Job done, need to invoice" never asks for the price or the customer again: it lands on a review seeded from the quote (job, customer, line items, terms, billed so far, paid so far, an editable amount) and the saved invoice is linked to the quote.
**Tests:** unit `jest/unit/invoice-from-quote.test.ts` ("REQ-023 …") · integration `jest/integration/invoice-parity.int.test.ts` ("REQ-023 …", derive-from-quote pin) · e2e `cypress/e2e/ux-invoice-review.cy.ts` ("REQ-023 …")

## REQ-024 — 4.2 NW-13 + NW-18 + NW-16 A brand-new invoice runs the wizard and lands on the shared preview
**Source:** new-working-issues.md NW-13 (PDF p9), NW-16 (PDF p12), NW-18 (PDF p27), 2026-09-18
**Requirement (client's words):** "The invoice needs all the same terms as a quote, and that process is already built." / "It should be the same: if there is no quote to select, go through the same questions as the quote (skip how long it took, but ask for the completion date). Right now there is no preview, just 'Invoice ready 🎉 … Send it now'." — "Job done, need to invoice" without an accepted quote runs the wizard (customer → completion date → payment terms → warranty), lands on the shared preview in invoice mode, and sends an invoice linked to the agreement.
**Tests:** unit (Deno) `backend/src/agents/domain/business/terms-wizard-spec/test.ts` ("REQ-024 …") · integration (Deno) `transition-to-terms/int.test.ts` + `handle-wizard-answer/int.test.ts` ("REQ-024 …") · e2e `cypress/e2e/ux-invoice-review.cy.ts` ("REQ-024 …")

## REQ-025 — 4.3 NW-13 cleanup: the standalone invoice customer step is deleted
**Source:** new-working-issues-plan.md §4.3 (cleanup after 4.1 + 4.2), 2026-09-18
**Requirement (plan's words):** "Delete the standalone … `createInvoiceFromFlow`, `openInvoiceCustomerStep`, the `invoiceCustomerOpen` state and their entries in `pushHistory`/`popHistory`/`composerHidden` … Delete lang keys … once nothing references them … Update `TDD-QUOTE-FLOW.md` row 5 and `TESTS-UX-PROBLEMS.md` UX-31 to point at the new spec … Verify: `cd front-end && deno task build`; full Cypress `run:assistant` + `run:invoice` green." — after REQ-024 nothing reaches the pre-wizard standalone customer step, so it goes away and no orphaned `asstChat.invoiceFlow.*` copy stays in either dictionary.
**Scope decision:** the plan (written before 4.1 landed) also lists `invoiceReview` / `saveInvoiceFromReview` / `invoiceResult` / `resolveAssistantBack.invoiceResultOpen` and the `readyTitle|readySub|sendNow|viewInvoice|goToInvoices|reviewTitle|saveCta|noAmount|noContact|dueDateLabel` keys. Those are KEPT: REQ-023's accepted-job path lands on that seeded review (billed / paid / editable amount) and saves through it, and `cypress/e2e/ux-invoice-review.cy.ts` ("REQ-023 …") pins it. Only `needCustomer` had no reader left.
**Tests:** unit `jest/unit/invoice-flow-cleanup.test.ts` ("REQ-025 …" — source pin: the three symbols are gone, `needCustomer` is gone from both dictionaries, every remaining `asstChat.invoiceFlow.*` key is referenced) · integration `n/a — no backend change` · e2e `n/a — no new behaviour; existing `run:assistant` + `run:invoice` suites must stay green`

## REQ-026 — 5.1 NW-05 Honest scope bullets from raw text — the fallbacks never echo the contractor's sentence
**Source:** new-working-issues.md NW-05 (PDF p4), 2026-09-18
**Requirement (client's words):** "The AI must never echo the user's raw input back as the suggested description. (Screenshot: all three 'I Need To' options just repeat 'I need to replace a toile for $500'.) We are the ones professionalizing the quotes." — when the model cannot be used (call failed, unparseable reply, dev stub) both fallbacks derive honest scope bullets (intent opener, price clause and pricing question stripped; one bullet per line) instead of bulleting the raw sentence, title the job from that scope (never "I Need To"), and report `degraded: true`; a usable model reply passes through with `degraded: false`.
**Tests:** unit `jest/unit/scope-from-raw.test.ts` ("REQ-026 …", pure helper `shared/quote-flow/scope-from-raw.ts`) · integration (Deno) `backend/src/agents/domain/coordinators/generate-job-options/int.test.ts` + `polish-job-details/int.test.ts` ("REQ-026 …") · e2e `n/a — the live dev server runs the real model; the fallback path is only reachable under the stub, which the Deno tests drive directly`
**Repro (before):** stub LLM → options `[{"jobName":"I Need To","bullets":["I need to replace a toile for $500"]}, …]`, polish `description: "I need to replace a toile for $500"`. **After:** `[{"jobName":"Replace A Toile","bullets":["Replace a toile"]}, …]`, polish `description: "Replace a toile", degraded: true`.
**Note:** `jest/integration/ux-job-name.int.test.ts` fails 4 cases against this dev server before and after (it pins the stub fallback's titles, but the dev server runs the real model: "Pintura Sala Comedor", "Reemplazo de Tablas") — pre-existing, unchanged by this work.

## REQ-027 — 5.2 NW-11 The job-details picker waits for the model; the heuristic is an honest error path
**Source:** new-working-issues.md NW-11 (PDF p20), 2026-09-18
**Requirement (client's words):** "Confirm the 'Confirm your job details' page is working correctly. (Screenshot: the three options are the raw text verbatim; 'Wider scope' only adds 'Jobsite cleanup'.)" — the picker shows "Writing up your options…" until the model answers instead of painting a client-side echo first; when the request fails or the server reports `degraded`, the cards are honest scope bullets (shared `scopeBulletsFromRaw`, never the typed sentence), a visible note says the draft could not be made, and the picker's "Write it myself" tile is prefilled with the contractor's own text.
**Decision:** the honest cards stay selected by default and the prefilled "Write it myself" tile opens on tap (the plan's "editor open" reading would make the raw sentence the default submission, which is exactly NW-05's complaint); the tile auto-opens only when nothing scope-like survived the contractor's text.
**Tests:** unit `n/a — the pure helper is pinned by REQ-026's jest/unit/scope-from-raw.test.ts` · integration `n/a — front-end only` · e2e `cypress/e2e/ux-help-me-price.cy.ts` ("REQ-027 …": delayed response → dots before any card; 500 → note + honest bullets + prefilled tile)

## REQ-028 — 5.3 NW-05 The prompts stop licensing the echo
**Source:** new-working-issues.md NW-05 (PDF p4), 2026-09-18
**Requirement (client's words):** "The AI must never echo the user's raw input back as the suggested description. … We are the ones professionalizing the quotes." — the job-options prompt states the rule ("Never return the contractor's sentence verbatim as a bullet or summary. Rewrite every bullet as a scope line; drop prices, 'I need to', and questions.") and the polish prompt's "mirror it back cleaned-up" clause is replaced by "write one neutral scope sentence from the facts given — never the contractor's own sentence"; both prompts stay English and identical in both dictionaries.
**Tests:** unit `jest/unit/i18n-dictionary-consistency.test.ts` ("REQ-028 …") · integration `n/a — prompt text; the model's behaviour is checked by a live probe recorded below` · e2e `n/a`
**Live probe (gpt-4o-mini, dev server, "I need to replace a toile for $500"):** before JSON mode the options call fell to the (honest) fallback 4 of 5 times — the model's reply was syntactically broken JSON (a missing brace between the es/en byLang blocks, captured by the new `[generate-job-options] reply not usable` warning). With `responseFormat: "json"` (OpenAI JSON mode, no chat tools on the one-shot calls) 6 of 6 probes returned three rewritten options ("Reemplazo de Inodoro" / "Instalación de Inodoro" / "Cambio de Inodoro", bullets like "Retirar inodoro existente", "Instalar inodoro nuevo", "Conectar fontanería"); polish → "Toilet Replacement", degraded:false.
**Tests (addendum):** integration (Deno) `generate-job-options/int.test.ts` + `polish-job-details/int.test.ts` ("REQ-026 … (b)"/"… passes through": the stub sees `responseFormat === "json"`) · `backend/src/agents/domain/data/openai/smk.test.ts` unchanged and green.

## Decisions pending (plan Phase 6, folders 28–36) — not started, by the plan's own rule
_2026-09-19 — "Do not start these tasks until the answer is back." Each is one client answer away; the work each answer unlocks is scoped in `plan/28…36/context.md`._
- **28 NW-02** whose contact goes in the customer-doc footer: house (`hello@paperworkmonster.com` / 866-767-8399, p24) or the contractor's (p61, shipped).
- **29 NW-03/NW-38** remove the "Just give me a quick quote" chip (byte-identical to "I know my price"; p35 says REMOVE) — recommended: remove.
- **30 NW-04/NW-07** on the job-details step keep the composer or the "Write it myself" box — recommended: composer (Option A).
- **31 NW-37** pricing page: the shipped 2026-08-31 recap (Free $0 / $99 / $199 / custom) or p34 ($15 Starter, no Free).
- **32 NW-44** badge wording "Accepted" (ships) vs "Approved" (p41).
- **33 NW-57/p57** "01 The deal in plain English": rename to "Quick Summary" or delete the section.
- **34 NW-55** a real per-contractor invoice number sequence, or keep the derived `#{id.slice(0,8)}`.
- **35** missing artefacts: the "Yam" screenshot/sentence (NW-21), the new logo (NW-53c), the empty "Quote and Agreement change" bullet (NW-53g), the "Contract for new job" screenshot (NW-57), "Quote & Agreement - Final.docx" (NW-46).
- **36** scope calls: neutral-LatAm Spanish as the one dialect (NW-51c), "the quote is the contract" (NW-56), competitor feature list + import (NW-58).

## REQ-029 — 7.1 NW-22 + NW-35 Create a customer straight from the assistant dropdown; never a silently disabled Next
**Source:** new-working-issues.md NW-22 (PDF p15) + NW-35 (PDF p30), 2026-09-18
**Requirement (client's words):** "I created a new customer ('Incredible Hulk', business 'Green Machine') and it did not save." / "You can create customers from the Customers page but not from My Assistant, yet the new-customer input shows up in the My Assistant dropdown." — typing a name with no match in the assistant's customer dropdown offers `Create "<name>"`, which opens the create form with the name prefilled and saves to the same Customers list; when the form has no phone or email the reason is shown (not just a disabled Next); the server's own-contact rejection is the contractor's dictionary copy in their language.
**Tests:** unit `n/a — panel wiring` · integration (Deno) `backend/src/agents/domain/coordinators/handle-wizard-answer/int.test.ts` ("REQ-029 …" es + en dictionary copy) · e2e `cypress/e2e/ux-assistant-pick-customer.cy.ts` ("REQ-029 …": create from search → on /api/customers; name-only → visible hint)

## REQ-030 — 7.2 NW-25 Reject fictional numbers before Twilio; report each channel honestly
**Source:** new-working-issues.md NW-25 (PDF p16), 2026-09-18
**Requirement (client's words):** "On 'send': the email went out but the text failed with Twilio 400, error 21211 'Invalid To Phone Number: +1555555XXXX'. … I did receive the quote via email." — a fictional US number (area code 555, or the reserved 555-01XX block) is rejected before any SMS is attempted with a translated reason; Twilio's 21211 / 21610 / 21614 become dictionary copy, never raw JSON; an invoice send reports each channel (emailed but the text failed) and only reloads silently when nothing failed.
**Scope decision:** the plan's "reject the whole 555 exchange" (and rejecting inside `normalizePhone`) would fail every dev/test login persona (512-555-6xxx, and three specs log in with 555-01XX numbers) and real 555-XXXX lines outside 01XX are assignable — so the pre-Twilio rule is the exported `isFictionalUsNumber` predicate applied on the customer SMS send path only (area code 555, or the reserved 555-01XX block); `normalizePhone` (login/OTP) is unchanged, and Twilio's own 21211 is surfaced honestly for the rest. One backend fixture that texted a fictional 555-01XX customer number was moved to a real exchange.
**Tests:** unit (Deno) `backend/src/users/domain/business/normalize-phone/test.ts` + `backend/src/users/domain/data/sms/smk.test.ts` ("REQ-030 …") · unit (jest) `jest/unit/send-result.test.ts` ("REQ-030 … summarizeDispatch") · e2e `cypress/e2e/invoice-send-honesty.cy.ts` ("REQ-030 …")

## REQ-031 — 7.3 NW-26 "Ask a question" reaches the contractor by email + text, and reads in full on the dashboard
**Source:** new-working-issues.md NW-26 (PDF p17), 2026-09-18
**Requirement (client's words):** "From the emailed link I filled in the 'Ask a question' box at the bottom of the quote ('Question sent — your contractor will follow up directly'), but I never received the question. Where does it go?" — a public inquiry emails and texts the contractor the full question plus the "contact me back" value (in the contractor's language, logged in the comms trail), and the dashboard activity feed shows the question body, not just "<name> asked a question".
**Tests:** unit `n/a — coordinator is I/O composition` · integration (Deno) `backend/src/paperwork/domain/coordinators/send-inquiry-alert/int.test.ts` ("REQ-031 …") + jest `jest/integration/inquiry-alert.int.test.ts` ("REQ-031 …", comms trail over HTTP) · e2e `cypress/e2e/public-doc-state.cy.ts` ("REQ-031 …", feed body)

## REQ-032 — 7.4 NW-28 Signature block: the named sentence in both languages from one module, "↓" parity, PDF parity
**Source:** new-working-issues.md NW-28 (PDF p19), 2026-09-18
**Requirement (client's words):** "04 SIGN HERE: 'By signing below, Thing agrees to everything above.' (currently 'agree'). Contractor box: 'CONTRACTOR SIGNATURE', business name (HANS LLC), the signature, 'By: Hans Pedersen', 'Date: May 23, 2026'. Customer box: 'YOUR SIGNATURE — Sign & type name below'. Everything else the same. (The Spanish signed view already has this layout.)" — the shared signature block speaks both languages (named sentence, Por:/Fecha:, Tu firma, the "↓"), the web document uses it for EN and ES alike (no per-language forks), the named form also applies when the signer's typed name is the only name known, and the PDF carries the sentence and the "CONTRACTOR SIGNATURE" / "YOUR SIGNATURE" titles.
**Tests:** unit `jest/unit/signature-block.test.ts` ("REQ-032 …") · integration `n/a — PDF text checked by rendering + pdftotext (recorded below)` · e2e `cypress/e2e/public-quote-signature.cy.ts` ("REQ-032 …")
**PDF probe (dev API, EN contractor, customer "Green Goblin"):** `GET /api/quotes/:id/pdf` text streams contain "By signing below, Green Goblin agrees to everything above.", "CONTRACTOR SIGNATURE" and "YOUR SIGNATURE"; "CLIENT SIGNED" is gone (checked by inflating the content streams and decoding the Tj hex strings — no pdftotext on the box).
**Note:** `public-quote-signature.cy.ts`'s ceremony test fails identically before and after this work (documented P-40: the signed page never renders the captured signature image; the retry then reloads an already-signed quote and reports the sign form missing).

## REQ-033 — 7.5 NW-39 QuickBooks-style collapse control inside the sidebar
**Source:** new-working-issues.md NW-39 (PDF p36), 2026-09-18
**Requirement (client's words):** "Sidebar collapse: the arrow between HANS LLC and Settings that minimizes the sidebar should work like QuickBooks, showing the hamburger plus an arrow to minimize. Use the same pattern for the PM Assistant conversations panel and remove the existing button." — the rail carries its own one-button control (hamburger + arrow when open, hamburger when collapsed, the same pattern the conversations panel already has), the choice persists across reloads, and the topbar hamburger keeps working.
**Tests:** unit `n/a — island wiring` · integration `n/a` · e2e `cypress/e2e/dashboard-assistant-access.cy.ts` ("REQ-033 …")

## REQ-034 — 7.6 NW-43f The `/quotes?open=` panel gets a close control
**Source:** new-working-issues.md NW-43f (PDF p40), 2026-09-18
**Requirement (client's words):** "There is no back button for the steps. Needs a back button throughout so they can easily be edited." — the quote detail panel opened by `/quotes?open=<id>` (or tapping a row) has an X that closes it and removes `open` from the URL without leaving the page, like the invoice panel.
**Tests:** unit `n/a — island wiring` · integration `n/a` · e2e `cypress/e2e/quotes-open-panel.cy.ts` ("REQ-034 …")

## REQ-035 — 7.7 NW-55 Expandable "Terms and Conditions", a Cancelation row, and a Send dialog with Keep/Cancel
**Source:** new-working-issues.md NW-55 (PDF p63), 2026-09-18
**Requirement (client's words):** "Cancelation (either side can cancel with 7-day notice; work completed will be paid for). At the bottom, an expandable 'Terms & Conditions' containing all the required notices from slide 13. … 'Send to client' opens 'How do you want to send to customer?' with Text / Email / Text + Email and Keep / Cancel." — on the web agreement the 14 clauses sit collapsed under a "Terms and Conditions" summary (the PDF stays flat), the term grid always shows a Cancelation row ("7 days' notice"), the termination clause ends with "Work completed before cancelation will be paid for." (web + PDF, both languages), and the assistant's Send opens a dialog titled "How do you want to send to customer?" with the three channels and Keep (sends) / Cancel (closes without sending). The invoice number sequence waits for decision 34.
**Tests:** unit `jest/unit/i18n-dictionary-consistency.test.ts` ("REQ-035 …") · integration `n/a` · e2e `cypress/e2e/public-quote-signature.cy.ts` ("REQ-035 …" ×2) + `cypress/e2e/ux-send-moment.cy.ts` ("REQ-035 …")
**PDF probe (dev API, EN, quote with payment + warranty terms):** the term grid renders "CANCELATION / 7 days' notice" next to PAYMENT TERMS and WARRANTY, and clause 10 ends with "Work completed before cancelation will be paid for." (content streams inflated, Tj hex strings decoded).
**Spec updates (conscious):** the three specs that pressed Send now press the dialog's Keep (`ux-send-moment`, `assistant-experience`, `ux-invoice-review`); `public-quote-signature` REQ-015 opens the collapsed notices before reading clause text.

## REQ-028 — AMENDMENT (2026-09-19): three versions, always
**Why:** the P-24 picker pin failed live with ONE card: gpt-4o-mini answered a single option object carrying three duplicate `"byLang"` keys (JSON.parse keeps the last). Five probes in a row reproduced it; the new `[generate-job-options] model returned N option(s)` warning captured the raw reply.
**Change:** the structure override asks for one flat object per option keyed by language (the normalizer already accepted that shape) with all three example objects spelled out; a usable but short answer (1–2 options) is padded to three with honest variants of the first ("· Short version" / "· Wider scope"); prompt-example placeholders echoed back ("...", "…", "<scope line>") are never treated as scope (the dev stub echoes the prompt, and the example is valid JSON).
**Evidence:** after the change 5/5 probes returned three distinct model options with no padding; `assistant-experience.cy.ts` 9/9.
**Tests:** integration (Deno) `generate-job-options/int.test.ts` ("REQ-028 … padded to three distinct versions", "… placeholders … honest fallback"; (b) now expects 2 model options + 1 variant).

## REQ-036 — 7.8 NW-57 Agreement header: "<Customer>'s <Job> Agreement", the job in the parties line, "Quick Summary"
**Source:** new-working-issues.md NW-57 (PDF p82), 2026-09-18
**Requirement (client's words):** "The job name goes between Contractor name and Client. 'New Job' → 'Godzilla's Concrete Patio Agreement'. 'Between Paperwork Monster and Godzilla effective May 7, 2026'. 'The Deal in Plain English' → 'Quick Summary'." — the hero title is "<Customer>'s <Job> Agreement" / "Acuerdo de <Job> de <Customer>" (a placeholder job name never leaks; no customer → the job), the parties line reads "Between <Contractor> ('Contractor') and <Customer> ('Client') for <Job> · effective <date>", the first section is "Quick Summary" / "Resumen rápido", and the PDF mirrors the title and the job in its recital.
**Note (decision 33):** the plan sequences this after the client's answer on the plain-English section (rename vs delete); p82 is the later, explicit instruction ("→ Quick Summary"), so the rename ships now and a delete would be a small follow-up.
**Tests:** unit `jest/unit/ux-page-copy.test.ts` ("REQ-036 …", pure `shared/quote-flow/agreement-title.ts`) · integration `n/a — PDF checked by the rendering probe below` · e2e `cypress/e2e/public-quote-signature.cy.ts` ("REQ-036 …" + the Quick Summary pin)
**PDF probe (dev API, EN, customer Godzilla, job Concrete Patio):** the PDF hero reads "Godzilla's Concrete Patio Agreement" and the recital "Between HANS PEDERSEN ("Contractor") and Godzilla ("Client") for Concrete Patio".

## REQ-037 — 7.9 NW-43b Completion text AND email after send/sign — the send dialog collects the missing contact
**Source:** new-working-issues.md NW-43b (PDF p40), 2026-09-18
**Requirement (client's words):** "After quotes and signed quotes, send a completion text and email." — when the chosen channel needs a contact the customer lacks (Text + Email with no email or no phone on file), the send dialog shows an inline "Add an email to also email it" / "Add a phone to also text it" field; filling it saves the contact to the customer and the send goes out on both channels (and every later alert — accepted, signed, receipts — has both channels to use).
**Tests:** unit `n/a — island wiring over the existing customer PUT` · integration `n/a` · e2e `cypress/e2e/ux-send-moment.cy.ts` ("REQ-037 …")

## REQ-038 — 7.10 NW-06b Business website on the From block
**Source:** new-working-issues.md NW-06 (PDF p5), 2026-09-18
**Requirement (client's words):** "Make sure the 'From' block includes email and website when the Dragon has provided them." — the business identity has a website (Settings input, saved through the identity endpoint; a bare domain is stored with https://), and every From surface shows it when present: the public agreement's From card, the assistant preview's From hero, the PDF From lines and the email's sender block.
**Tests:** unit (Deno) `backend/src/users/domain/data/business-identity-store/smk.test.ts` ("REQ-038 …") · integration (jest) `jest/integration/business-website.int.test.ts` ("REQ-038 …") · e2e `cypress/e2e/settings-editable.cy.ts` + `cypress/e2e/public-quote-signature.cy.ts` ("REQ-038 …")
**Probes:** `PUT /profile/identity {websiteUrl:"https://hans.work"}` → `GET /quotes/:id/public` `contractor.websiteUrl` present; `GET /quotes/:id/pdf` From lines carry "hans.work".

## REQ-039 — 7.11 NW-52 Soft delete + "recover the old account" on repeat-phone signup
**Source:** new-working-issues.md NW-52 (PDF p58), 2026-09-18
**Requirement (client's words):** "Delete scope: do not delete data, flag it as 'deleted'. When someone signs up with the same phone number, offer to create a new account or recover the old one." — deleting a quote, a customer or the account flags the row with `deletedAt` (lists exclude it; owners can still read it with `includeDeleted`; the account's phone index survives); a verified sign-in on a closed account's phone returns `recoverable` with a one-shot recovery token instead of a session, and `/verify` offers "Recover my account" (clears the flag, signs in) or "Start fresh" (archives the old account's phone under `#archived-<ts>` and creates a new account on the number). `GET /me/wipe` stays the only hard delete (dev/test reset).
**Tests:** unit/integration (Deno) `quote-store/soft-delete.test.ts`, `customer-store/smk.test.ts`, `user-store/smk.test.ts`, `verify-otp/int.test.ts`, `account-recovery/int.test.ts` ("REQ-039 …") · integration (jest) `jest/integration/account-recovery.int.test.ts` · e2e `cypress/e2e/account-recovery.cy.ts`
**Contracts:** `/api/auth/verify` (front-end proxy) answers **409** `{ ok:false, error:"account_closed", recoverable:true, recoveryToken }` for a closed account (loud for scripted logins); the backend `/auth/verify` answers 200 `{ ok:true, recoverable:true, recoveryToken }`; `POST /auth/recover` / `POST /auth/start-fresh` take `{ token }` and open the session. Danet registers every controller prototype method as a route, so controller helpers stay module functions.
**Note:** `onboarding-wizard.cy.ts` fails 3 "education + hand-off" cases before and after this work ("meet your assistant" copy no longer exists in any dictionary) — pre-existing, unrelated.

## REQ-040 — 7.12 NW-43c + NW-51a Mobile: sized with a live run
**Source:** new-working-issues.md NW-43c (PDF p40) + NW-51a (PDF p48), 2026-09-18
**Requirement (client's words):** "Make it mobile-friendly." / "Flawless mobile view with the same perfect UX translated to small screens." — the plan's sizing step: run the responsive specs live and turn each red into its own task.
**Result (2026-09-19):** `responsive-mobile` 8/8, `landing-mobile-390` 6/6, `ux-landing-mobile` 6/6, `ux-dashboard-mobile-390` 4/4 after one stale pin was corrected (UX-09's "Registro completo →" check targeted a control removed on purpose — no `/activity` page exists, the link 404'd in prod; the pin now asserts its absence and keeps the clip-geometry checks for when it returns). **No mobile red survived the run → no follow-up task folders.** The board in `TESTS-PROBLEMS.md` carries the numbers.
**Tests:** `no new tests — audit`; the four responsive specs above are the evidence (e2e).

## REQ-041 — 7.13 NW-53f + NW-53b + NW-48 Three polish items from the "COMPLETED" half
**Source:** new-working-issues.md NW-53f, NW-53b (PDF p60), NW-48 (PDF p45), 2026-09-18
**Requirement (client's words):** "Pricing: auto-focus the number field, and pressing Enter on the price should click Continue." (also in help-me-price) / "If they are tapping options there should be no input field." / the p45 text template puts "[LINK]" on its own line after "…is ready:".
**Tests:** unit `jest/unit/i18n-dictionary-consistency.test.ts` ("REQ-041 …", `{url}` after a newline in both dictionaries) · integration (Deno) `send-paperwork-sms` suite (green on arrival) · e2e `cypress/e2e/quotes-help-me-price.cy.ts` ("REQ-041 NW-53f …" autofocus RED→GREEN; "REQ-041 NW-53b …" composer-absent pin, green on arrival as the plan predicted)

## REQ-042 — Merge gate: the repo declares its suite in `.worktree-check`
**Source:** `/worktree-merge` triage on branch `new-working-issues`, 2026-09-19
**Requirement:** the merge gate must run the repo's real suites. With no `.worktree-check`, `worktree-merge` auto-detects `deno test -A` at the git root, which type-checks `jest/**/*.test.ts` (a Node/Jest harness outside the Deno workspace) and aborts on 2,340 `TS2304: Cannot find name 'expect'` errors before a single test runs — `develop` is red the same way — and would run the backend's KV tests without `--unstable-kv`. The executable `.worktree-check` at the git root now runs, in order: `cd backend && deno task test`, `cd front-end && deno check`, `cd jest && npm run test:unit`. Jest integration and Cypress stay out (they need the live dev server) and are reported through `--tested`.
**Tests:** `no tests — the gate script is itself the check; its first run is the merge's gate run recorded for this commit.`

## REQ-043 — Footer "Terms of Service" link on every page → /terms (Terms, Refund & Cancellation, Privacy)
**Source:** Raphael, 2026-09-24
**Requirement (client's words):** "to the bottom of every page in the footer, put a link to 'terms of service' and then link it to html that renders something like this" — followed by the full text of the Terms of Service, the Refund & Cancellation Policy and the Privacy Policy (all effective September 24, 2026). Every page family gets a `SiteFooter` with the link at the bottom of its shell (landings' existing footers, the login/verify/contact card, the welcome shell, the public documents, the dashboard `.content` scroll, the assistant page, the error page and /terms itself); `/terms` renders the three documents from `shared/legal/terms.ts` verbatim, including the `[INSERT …]` address/email placeholders the client left to fill in.
**Tests:** unit `jest/unit/legal-terms.test.ts` ("REQ-043 …") · integration `jest/integration/terms-footer.int.test.ts` ("REQ-043 …") · e2e `cypress/e2e/terms-footer.cy.ts` ("REQ-043 …")
**Evidence (2026-09-24):** unit `jest/unit/legal-terms.test.ts` 6/6 (RED on the dictionary keys first) · integration `-t REQ-043` 18/18 (RED on every page first: no link, /terms 404) · e2e `cypress run --spec e2e/terms-footer.cy.ts` 10/10 · gate `.worktree-check` all green (backend 895/895, front-end `deno check`, jest unit 488) · browser check: /terms renders the three documents, the assistant shell shows the link under the chat (its grid `.asst` gives up 30px for it).
**Known:** the public pages (login/contact/terms) are Spanish-first by product decision, so the label reads "Términos de servicio" until the visitor picks English; the legal text itself is English only and is not machine-translated. The `jest/integration` UX-05 job-name spec fails before and after this work (LLM output casing) — unrelated.
**AMENDMENT (2026-09-24), Raphael:** "this is in english only. it should be both" — `/terms` renders the three documents in the visitor's language (`?lang=` → `pm_lang` cookie → Spanish-first like the other public pages) with an EN/ES toggle at the top; the Spanish text lives in `shared/legal/terms.es.ts` with the exact structure of the English (same ids, section numbers, block kinds and list lengths — pinned by the unit test). The Spanish is a translation made here, not attorney-reviewed.
**Tests:** unit `jest/unit/legal-terms.test.ts` ("REQ-043 the Spanish documents mirror the English structure") · integration `jest/integration/terms-footer.int.test.ts` ("REQ-043 GET /terms renders in Spanish for a Spanish visitor") · e2e `cypress/e2e/terms-footer.cy.ts` ("REQ-043 the terms page shows both languages through its EN/ES toggle")
**Evidence (amendment):** unit `legal-terms.test.ts` 9/9 (RED first on the missing Spanish module) · integration `-t REQ-043` 22/22 · cypress `terms-footer.cy.ts` 11/11 · browser: `/terms?lang=es` renders the three Spanish documents with the EN/ES toggle.

### REQ-043 AMENDMENT (2026-09-24) — business mailing address filled in
Raphael: "update the website with this address … 4505 Socastee Blvd, Myrtle Beach, SC 29588". Every `[INSERT BUSINESS MAILING ADDRESS]` / `[INSERTAR DIRECCIÓN POSTAL DE LA EMPRESA]` placeholder in the Terms, Refund and Privacy documents (EN + ES) now reads that address; the email placeholders are unchanged. Test: `jest/unit/legal-terms.test.ts` ("REQ-043 Terms of Service: the arbitration notice and 31 numbered sections" pins the address in §26). Shipped as a quick hotfix branch at Raphael's request, not via /worktree.

## REQ-044 — Support number 855-362-8666 everywhere; phone + mailing address in the footer of every page
**Source:** Raphael, 2026-09-24
**Requirement (client's words):** "change the number everywhere on the site to 855-362-8666. add the phone number to the footer on every page as well as the address." — the toll-free support number shown anywhere on the site (landing footers and hero, /contact, the dashboard "Call support" CTA) is 855-362-8666, held in one shared module (`shared/legal/contact.ts`) so no page carries its own copy; the `SiteFooter` every page ends with (REQ-043) gains a `tel:` link to that number and the business mailing address (4505 Socastee Blvd, Myrtle Beach, SC 29588 — the same address the legal documents carry), and the two landings' own footers gain the address next to their phone link.
**Tests:** unit `jest/unit/support-contact.test.ts` ("REQ-044 …") · integration `jest/integration/footer-contact.int.test.ts` ("REQ-044 …") · e2e `cypress/e2e/footer-contact.cy.ts` ("REQ-044 …")
**Evidence (2026-09-24):** unit `jest/unit/support-contact.test.ts` 4/4 (RED first: `shared/legal/contact` missing) · integration `jest/integration/footer-contact.int.test.ts` (RED first on every page: no `data-site-phone` / `data-site-address`) — `-t 'REQ-044|REQ-043'` 48/48 · e2e `cypress run --spec e2e/footer-contact.cy.ts,e2e/terms-footer.cy.ts` 26/26 (15 new + the 11 REQ-043 ones) · gate `.worktree-check` all green (backend 895/895, front-end `deno check`, jest unit 495) · browser: the login card, the root landing and the promo landing footers show 855-362-8666 (tel: link) and the address.
**Known:** the assistant shell's `.asst` no longer assumes a 30px footer — it is `flex: 1` under the footer, so the wrapped footer on narrow screens is not clipped (pinned by the 390px Cypress case). `TWILIO_SUPPORT_NUMBER` in the untracked `.env` still names the old 866 line — the number Twilio actually forwards is Raphael's to switch; the site itself no longer mentions it. The reverse-documentation under `front-end/ui-breakdown/` still quotes the old number as a spec snapshot; not site source.
