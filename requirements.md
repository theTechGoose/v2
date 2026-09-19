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
