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
