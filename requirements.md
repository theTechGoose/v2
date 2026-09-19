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
