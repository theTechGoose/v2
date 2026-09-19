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
