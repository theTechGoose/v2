# New Working Issues — Execution Plan

Scoped 2026-09-18 from `new-working-issues.md` (the triage) against worktree `new-working-issues` @ `7a53141`.
Every file:line below was re-read from this tree while writing the plan; where the triage had a stale path it is
corrected here. Read the triage for *evidence*; read this file for *what to do, in what order, and how to prove it*.

**How to use this file.** Work top to bottom. Each numbered task is one worktree, one `REQ` id, one merge. Inside a
task, do the sub-bullets in order and tick them. If a step says "expect X" and you do not see X, stop and figure out
why before going on — do not skip ahead. Nothing here needs a design decision unless the task title starts with ❓.

Legend: 🐛 bug · ⬜ not built · ◩ partly built · ❓ needs the client's answer first · ⚠ cannot be proven from code alone.
Effort: S ≤ half a day · M ≈ 1–2 days · L ≥ 3 days.

---

## 0. Setup — read once, then follow for every task

### 0.1 Tools you need on the machine

- [ ] `deno` (the app), `node`+`npm` (jest + cypress). Check: `deno --version && node --version`.
- [ ] Jest deps are installed already (`jest/node_modules` exists). Cypress deps are **not**: run `cd cypress && npm install` once.
- [ ] A `.env` at the repo root with `OPENAI_API_KEY=…` (needed for every LLM-backed integration/e2e test). Do not commit it.

### 0.2 The four test layers and how to run each

| Layer | Where | Needs the dev server? | Run all | Run one file |
|---|---|---|---|---|
| Unit (Jest) | `jest/unit/*.test.ts` — pure logic, imports `shared/quote-flow/*` | no | `cd jest && npx jest --selectProjects unit` | `cd jest && npx jest unit/<name>.test.ts` |
| Integration (Jest) | `jest/integration/*.int.test.ts` — real HTTP to `:5280/api` | **yes** | `cd jest && npx jest --selectProjects integration` | `cd jest && npx jest integration/<name>.int.test.ts` |
| E2E (Cypress) | `cypress/e2e/*.cy.ts` — real browser | **yes** | `cd cypress && npm run run` | `cd cypress && npx cypress run --spec e2e/<name>.cy.ts` |
| Backend (Deno) | `backend/src/**/*.test.ts` — coordinators/stores | no | `cd backend && deno task test` | `cd backend && deno test -A --unstable-kv src/<path>/test.ts` |

- [ ] Start the dev server (one terminal, leave it running): from the repo root `deno task serve` → backend `:4280`, frontend `:5280`. It sets `AGENTS_LLM_CLIENT=openai` itself (`serve.ts:42`).
- [ ] **Baseline you must reproduce before touching anything** (verified 2026-09-18 on this tree):

  ```
  cd jest && npx jest --selectProjects unit
  Test Suites: 38 passed, 38 total
  Tests:       1 skipped, 416 passed, 417 total
  ```

- [ ] Test helpers you will reuse:
  - Jest integration: `import { contractor, anonymous, seedCustomer, seedQuote, seedInvoice } from "./helpers/api"` (`jest/integration/helpers/api.ts:94-150`). `contractor("+1512555XXXX")` logs in with master OTP `000000`. Use a **unique** phone per spec file so specs do not share state.
  - Cypress: `cy.loginAs(phone)`, `cy.apiCreateCustomer(body)`, `cy.apiCreateQuote(body)`, `cy.apiAcceptQuote(id)`, `cy.apiCreateInvoice(body)`, `cy.apiClaimPayment(...)`, `cy.apiConfirmPayment(...)`, `cy.seedQuoteToCash()` (`cypress/support/commands.ts:157-387`).
  - Every new `describe()` name starts with its `REQ-nnn` id, e.g. `describe("REQ-004 NW-10 quote is born draft", …)`.
  - Every new UI element a test needs gets a `data-cy="…"` attribute (existing convention; see `TDD-QUOTE-FLOW.md` "Contract selectors").

### 0.3 The loop — do this for EVERY task below, in this order

1. **Branch.** `/worktree <task-slug>` (slugs are given per task). Then run the two commands the skill prints (`DEST=$(~/.claude/tools/worktree-start --path) && cd "$DEST"`, then `~/.claude/tools/worktree-start --verify`). Never edit on `develop`/`main`.
2. **Reserve the id.** `~/.claude/tools/req-next` → prints `REQ-NNN` (first call on this repo prints `REQ-001`). Never invent the number.
3. **Record the requirement.** Append to `requirements.md` at the repo root (create it on the first task):

   ```markdown
   ## REQ-NNN — <task title>
   **Source:** new-working-issues.md NW-xx (PDF p<n>), 2026-09-18
   **Requirement (client's words):** "<paste the bullet from the triage>"
   **Tests:** unit `jest/unit/<f>.test.ts` · integration `jest/integration/<f>.int.test.ts` · e2e `cypress/e2e/<f>.cy.ts`
             (write `n/a — <why>` for any layer that does not apply)
   ```

4. **Write the RED tests first** — the files and assertions are listed per task. Run them. They **must fail**. Copy the failing lines into the commit message body later. If a test passes before you changed any code, the test is wrong.
5. **Make the edits** listed in the task, in order.
6. **Go GREEN.** Run the task's tests → pass. Then run the whole unit baseline (§0.2) → still 38/416 (+ your new ones). Run the integration/e2e files you touched with the dev server up.
7. **Update both dictionaries.** Any new `lang/en.json` key needs the same key in `lang/es.json` (a unit test enforces parity; it will go red if you forget).
8. **Commit** on the worktree branch: `git add -A && git commit` — subject like the repo's history (`fix(assistant): …`, `feat(invoices): …`), body = what/why + the red→green test output, last line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
9. **Merge.** `/worktree-merge` (it runs the gate; a RED gate refuses the merge — fix, do not force).

### 0.4 Corrections to the triage's paths (the code moved; the triage's line numbers are otherwise exact)

| Triage says | Actual path |
|---|---|
| `backend/src/paperwork/domain/business/lock-quote/` | `backend/src/agents/domain/coordinators/lock-quote/mod.ts` |
| `backend/src/agents/domain/business/handle-chat-message/` | `backend/src/agents/domain/coordinators/handle-chat-message/mod.ts` |
| `…/llm/implementations/stub/mod.ts` under `data/` | `backend/src/agents/domain/business/llm/implementations/stub/mod.ts` |
| `confirmSendFromReview` (`AsstChat.tsx:2816`) | function is `confirmSendQuote` (`AsstChat.tsx:2788-2816`) |

---

## Phase 0 — Prove which LLM production is running (root cause #1) — do this FIRST

### 0.A ⚠ Is prod on the stub LLM? (S, but it decides the size of Phase 5)

**Why it matters.** `backend/src/agents/mod-root.ts:53-61` picks `OpenAILLMClient` only when the env var
`AGENTS_LLM_CLIENT` equals `"openai"`; otherwise it silently picks `StubLLMClient`, whose only behaviour is to echo
`"(stub) <your text>"` (`…/llm/implementations/stub/mod.ts:43-44`). That echo fails JSON parsing, so every job-options
and pricing call falls to the deterministic fallbacks — which produce *exactly* the screenshots in NW-05, NW-11 and the
unanchored prices in NW-12. Only dev sets the var (`serve.ts:42`, `backend/deno.json:3-4`). The composed prod entry
`mod.ts` never reads it, and the repo has no deploy config, no `.env.example`, no `.github`, no `Dockerfile`.
`TRANSCRIPTION_CLIENT` (voice memos, `backend/src/files/mod-root.ts:15-18`) has the identical gap.

- [ ] **Step 1 — look at the hosting dashboard.** Find where prod runs (Deno Deploy is the assumption — `mod.ts:6` talks
      about Deploy's 508 self-fetch behaviour; ask Raphael/Hans if unsure). Open the project → Settings → Environment
      variables. Write down whether each of these is present: `AGENTS_LLM_CLIENT` (must be exactly `openai`),
      `OPENAI_API_KEY`, `TRANSCRIPTION_CLIENT` (`openai`), `OPENAI_MODEL` (optional; default is `gpt-4o-mini`).
- [ ] **Step 2 — if any is missing, set it, redeploy, and re-test** with the client's exact sentence in a fresh
      conversation: chip "I know my price, write it up" → type `I need to replace a toilet for $500` → price → the three
      options must be *rewritten* scope bullets, not the sentence. If they are still the sentence, the LLM call is
      failing at runtime → read the deploy logs for `[suggest-prices] llm call failed` / the generate-job-options catch.
- [ ] **Step 3 — make the silent fall-through impossible (code, small).** Slug: `llm-client-loud-boot`.
  - [ ] RED (backend Deno unit test): create `backend/src/agents/domain/business/llm/select/test.ts` with three cases on a
        new pure function `selectLlmClientName(env: { AGENTS_LLM_CLIENT?: string; DENO_DEPLOYMENT_ID?: string })`:
        `{AGENTS_LLM_CLIENT:"openai"}` → `"openai"`; `{}` → `"stub"`; `{DENO_DEPLOYMENT_ID:"abc"}` (prod, var unset) →
        **throws** `Error("AGENTS_LLM_CLIENT must be \"openai\" in production")`. Run `cd backend && deno test -A --unstable-kv src/agents/domain/business/llm/select/test.ts` → fails "module not found".
  - [ ] Create `backend/src/agents/domain/business/llm/select/mod.ts` exporting that function (no I/O inside).
  - [ ] In `backend/src/agents/mod-root.ts:53-61` replace the `if (Deno.env.get("AGENTS_LLM_CLIENT") === "openai")` with
        `if (selectLlmClientName({ AGENTS_LLM_CLIENT: Deno.env.get("AGENTS_LLM_CLIENT"), DENO_DEPLOYMENT_ID: Deno.env.get("DENO_DEPLOYMENT_ID") }) === "openai")`.
        Keep the dynamic import as is. (When the key is absent, `OpenAILLMClient`'s constructor already throws at boot —
        `openai/mod.ts:50-53` — so prod now fails loudly instead of echoing.)
  - [ ] Do the same for `backend/src/files/mod-root.ts:15-18` (`TRANSCRIPTION_CLIENT`), reusing the helper with a second env-key argument.
  - [ ] Add `.env.example` at the repo root listing: `OPENAI_API_KEY=`, `AGENTS_LLM_CLIENT=openai`, `TRANSCRIPTION_CLIENT=openai`, `OPENAI_MODEL=gpt-4o-mini`, `APP_URL=`. One comment line each. Commit it (it holds no secrets).
  - [ ] Root `deno.json:6` `start` task: prefix with `AGENTS_LLM_CLIENT=openai TRANSCRIPTION_CLIENT=openai ` so a VM/`deno task start` deploy matches `backend/deno.json:3`.
  - [ ] GREEN: the Deno test passes; `cd backend && deno task test` still green (tests never set the var and never set
        `DENO_DEPLOYMENT_ID`, so they keep the stub). Integration `n/a — env selection happens before any HTTP`. E2E `n/a`.
- [ ] **Done when:** the dashboard shows all vars, the toilet sentence produces rewritten options in prod, and the test file exists and passes.

---

## Phase 1 — Small, certain fixes (one worktree + one REQ each; all can run in parallel)

Nothing in this phase needs a product decision. Each task is a half-day or less unless marked otherwise.

### 1.1 🐛 NW-01 — Landing language toggle: Spanish button first (S) · slug `nw-01-lang-toggle-order`

**Goal.** On `/` the toggle reads "Yo hablo Español | I speak English" with Spanish first and selected by default.
**Why.** Default language is already Spanish everywhere (`front-end/lib/lang.ts:374-381`, `routes/index.tsx:199-203`) and the
labels are already exact, but `routes/index.tsx:291-299` renders the `data-lang="en"` button before the `data-lang="es"` one.
`/landing` already has ES first (`routes/landing.tsx:120-131`).

- [ ] RED — e2e: new `cypress/e2e/landing-lang-toggle.cy.ts`:
      `cy.visit("/")` → `cy.get(".lang-toggle button").first()` has attr `data-lang` = `es`, has class `on`, contains "Yo hablo Español";
      `.eq(1)` has `data-lang` = `en`, contains "I speak English". Run: `cd cypress && npx cypress run --spec e2e/landing-lang-toggle.cy.ts` → expect the first assertion to fail (first button is `en`).
- [ ] RED — integration: in `jest/integration/landing-pages.int.test.ts` (near the `<html lang="es">` pin at lines 113-120) add
      `it("REQ-NNN NW-01 the Spanish toggle button precedes the English one")`: fetch `/` HTML, assert
      `html.indexOf('data-lang="es"') < html.indexOf('data-lang="en"')`. Run → fails.
- [ ] Unit: `n/a — pure markup order, no logic`.
- [ ] EDIT `front-end/routes/index.tsx:291-308`: cut the whole `<button … data-lang="en" …>…</button>` block (lines 291-299) and
      paste it AFTER the `data-lang="es"` block (after line 308). Change nothing else; keep "Yo hablo Español" with the accent.
- [ ] GREEN: both tests pass; `cd cypress && npx cypress run --spec e2e/landing-mobile-390.cy.ts` still passes (it measures toggle alignment).
- [ ] Done when: `/` shows Spanish first and highlighted on a fresh browser with no cookie.

### 1.2 🐛 NW-10 — A quote is born `draft`, not `sent` (S) · slug `nw-10-quote-born-draft`

**Goal.** The review card's status chip says "Draft" until the contractor actually sends.
**Why.** `front-end/islands/AsstChat.tsx:2155-2158` posts `POST /quotes { ...quoteFields, status: "sent" }` at creation. The store
only defaults to `draft` when `status` is falsy (`quote-store/mod.ts:28`). Side effect: because the row is already `sent`,
`lock-quote/mod.ts:72` (`wasAlreadySent`) skips stamping `sentAt` and skips its `quote:sent` event.
**Do NOT touch `lock-quote`**: on the chat path "Lock it in" genuinely emails the quote (`lock-quote/mod.ts:89-99`), so `sent`
is truthful there. The real send for the price flow is `confirmSendQuote` (`AsstChat.tsx:2788-2816`) →
`POST /agents/conversations/:id/send-quote` → `send-quote/mod.ts:87-95`, which already stamps `status:"sent"` + `sentAt` on first dispatch.

- [ ] RED — integration: `jest/integration/quote-lifecycle.int.test.ts` add
      `it("REQ-NNN NW-10 POST /quotes with status:'sent' is still born a draft")`: `const id = await seedQuote(s, { status: "sent" })`;
      `GET /quotes/:id` → `expect(body.status).toBe("draft")`. Run → fails (returns `sent`).
- [ ] RED — e2e: `cypress/e2e/quotes-status-badges.cy.ts` add `it("REQ-NNN NW-10 the price flow creates a draft")`:
      `cy.loginAs(<unique phone>)`, `cy.visit("/assistant")`, click `button.chat__empty-prompt` containing "I know my price, write it up.",
      type `Paint a 50ft wooden fence` into `textarea.composer__input`, click `button.composer__send`, wait for `.chat__price-capture`,
      type `500` into its `input`, click `.chat__price-continue`, wait for `cy.location("pathname")` to match `/^\/assistant\/.+/`,
      then `cy.request("/api/quotes")` → newest row (max `createdAt`) has `status === "draft"`. Run → fails (`sent`).
- [ ] Unit: `n/a — no pure logic changes; jest/unit/quote-status.test.ts already pins the flow`.
- [ ] EDIT 1 `front-end/islands/AsstChat.tsx:2157`: delete the line `status: "sent",` (leave `...quoteFields`).
- [ ] EDIT 2 (belt and braces) `backend/src/paperwork/entrypoints/quote-controller/mod.ts:21`: split into
      `const dto = parseCreateQuote(body); if (dto.status === "sent" || dto.status === "viewed") dto.status = "draft";` then pass `dto`.
      If TypeScript says `status` is not on the DTO, add `@IsOptional() @IsString() status?: string;` to `CreateQuoteDto` in `backend/src/paperwork/dto/quote.ts`.
- [ ] EDIT 3 `backend/src/paperwork/domain/coordinators/send-paperwork-sms/mod.ts`: it never stamps `sentAt` (grep confirms zero hits),
      so an SMS-only send from `/quotes` leaves the quote `draft`. Copy the idempotent block from `send-paperwork-email/mod.ts:204-214`
      (`if (result.ok && input.kind === "quote" && quote && !quote.sentAt) await this.quotes.update(id, userId, { status:"sent", sentAt: now })`)
      into the SMS coordinator right after its successful send. Inject `QuoteStore` in the constructor if it is not already there.
- [ ] GREEN: the two red tests pass; `cd backend && deno test -A --unstable-kv src/agents/domain/coordinators/lock-quote/int.test.ts` still green (unchanged behaviour).
- [ ] Done when: after "Continue" on the price step, `/quotes` lists the new quote as Draft and the review-card chip reads Draft.

### 1.3 🐛 NW-20 — Back from the customer step returns to the price step (S) · slug `nw-20-back-from-customer-step`

**Goal.** Chip → details → price → Continue → customer step → header back = the price step, never `/dashboard`.
**Why.** `customer` is wizard step 0, so the shared resolver (`shared/quote-flow/assistant-back.ts:50-53`) can only "pop-view"
if a snapshot was pushed. Commit `4a1457a` added that push for the price panel (`AsstChat.tsx:2184-2185`) but nothing pins it.

- [ ] RED — e2e: `cypress/e2e/ux-assistant-single-back.cy.ts` add a third `it("REQ-NNN NW-20 back at the customer step returns to the price step")`:
      reuse `uxsbLogin()`, then the same walk as the first `it` up to `.chat__price-capture`; type `500` into its `input`; click `.chat__price-continue`;
      wait for pathname `/assistant/<id>`; wait for the customer step (`.cust-create` or the `wizard` card); click `a.chat__head-btn` (the ONE back control,
      `ChatHeaderLive.tsx:56-68`); assert `cy.location("pathname")` still matches `/^\/assistant\//` and `.chat__price-capture` is visible.
      Run → it should PASS already (the fix shipped in `4a1457a`). That is fine: this test is a regression pin, note "green on arrival" in the commit.
- [ ] Unit: `jest/unit/assistant-back.test.ts:47-50` stays as is — the resolver contract is unchanged. Integration `n/a — browser state`.
- [ ] Done when: the spec is in the suite and green.

### 1.4 ◩ NW-19 — Back works on the chat → "Lock it in" → terms path (M) · slug `nw-19-back-chat-lock-path`

**Goal.** From the wizard's first question reached via chat ("Lock it in" → "Ready" CTA), back returns to the action card instead of exiting.
**Why.** Three forward moves push no snapshot: `sendText→submitTurn` (`AsstChat.tsx:1763`), `lockActionCard` (`:3013`), and
`submitContinueCta` for `toPhase==="terms"` (`:2609`). Worse, even with a snapshot, `popHistory` at `:1108-1110` exits to
`/dashboard` whenever the popped snapshot has no wizard step and no panel while messages exist — which is exactly the chat state.
And the server's `RewindWizard` (`rewind-wizard/mod.ts:76-79`) clamps at step 0; it cannot leave the terms phase.

- [ ] RED — Deno int test: `backend/src/agents/domain/coordinators/rewind-wizard/int.test.ts` (create beside `mod.ts`, copy the setup of
      `transition-to-terms/int.test.ts`): after `TransitionToTerms`, call `RewindWizard.run({ conversationId, userId, toStepIdx: -1 })` →
      expect `conversation.currentPhase` to be the pre-terms phase, `wizardState` cleared, and the wizard message id in `removedMessageIds`. Run → fails.
- [ ] EDIT backend `rewind-wizard/mod.ts`: when `input.toStepIdx === -1` and `state.activeStepIdx === 0`, delete every `kind:"wizard"` message,
      clear the wizard state (`conversations.putWizardState(id, undefined)` or the store's equivalent), set `currentPhase` back to the value
      `transition-to-terms/mod.ts` came from (read that file: it sets `currentPhase:"terms"` — restore the previous phase it records, or `"chat"`).
      Return `activeStepId: null`.
- [ ] EDIT front-end `AsstChat.tsx`:
  - [ ] `:1763` — insert `pushHistory();` immediately before `await submitTurn(` (the `awaitingJobDetails` branch above already pushes via `submitJobDetails`).
  - [ ] `:3014` — after `if (sending || !convoId || !payload.quoteId) return;` insert `pushHistory();`.
  - [ ] `:2610` — after `if (!convoId) return;` inside the `toPhase === "terms"` branch insert `pushHistory();`.
  - [ ] `:1108-1110` — replace the unconditional exit with: if the transcript contains a `kind === "action_card"` or `"continue_cta"` message
        and `wizardCursor(messages) === 0`, call `void goBackWizard(-1)` (which hits the new server mode) and return; else keep the exit.
- [ ] E2E: `n/a — the action card only comes from the live LLM; not deterministic under the stub`. Manually verify once with a real key: type
      "Replace a toilet for $500 for Sam" in chat → action card → Lock it in → the wizard → back → the action card is visible again.
- [ ] Unit: `jest/unit/assistant-back.test.ts` — add `it("REQ-NNN NW-19 depth>0 at step 0 → pop-view")` (`{...base(), activeWizardStepIdx: 0, viewStackDepth: 1}` → `"pop-view"`). Passes on arrival; it pins why the pushes matter.
- [ ] GREEN: Deno test green; `cd cypress && npx cypress run --spec e2e/ux-assistant-single-back.cy.ts` and `e2e/assistant-history.cy.ts` still green.

### 1.5 ◩ NW-19b — Job Details is editable on the review card (M) · slug `nw-19-job-details-pencil`

**Goal.** The review card's Job Details section gets a pencil that reopens the job picker; every other field already has one.
**Why.** `AsstChat.tsx:5853-5879` renders Job Details as a plain `<ul>`/`<p>`; the editable pattern is `class="… quote-review__editable"` +
`contentEditable` + `onBlur` (`:5665-5690`) or the pencil buttons (`:6137`, `:6176`).

- [ ] RED — e2e: `cypress/e2e/ux-doc-preview.cy.ts` add `it("REQ-NNN NW-19 Job Details on the review card has an edit control")`: reach the
      review card the way that spec already does, then `cy.get("[data-cy=review-job-details-edit]").click()` → `.chat__jobopts` (the picker) is visible. Run → fails (no such element).
- [ ] EDIT `AsstChat.tsx:5857-5863`: inside the section label row add
      `<button type="button" class="quote-review__term-edit" data-cy="review-job-details-edit" aria-label={tFor(previewLang,"common.edit")} onClick={() => void openJobPicker()}>✎</button>`
      (`openJobPicker` is at `:1890`; it reads `jobPolishRawRef`/`quote.description`). After the picker's `applyJobOption` (`:2220`) the review re-renders from `polishedDescription` — verify that path updates the card; if not, call the same setter `applyJobOption` uses.
- [ ] Unit/integration: `n/a — component wiring; the picker itself is already covered by quotes-professionalize.cy.ts`.
- [ ] Done when: clicking the pencil shows the three-option picker, picking one updates the Job Details bullets on the card.

### 1.6 🐛 NW-06 — `/assistant` passes the `from` prop (S) · slug `nw-06-from-prop-and-website`

**Goal.** A conversation started at `/assistant` shows the From block (business, name, phone, email) on the review card.
**Why.** `front-end/routes/assistant/index.tsx:97-104` mounts `<AsstChat>` without `from`; `routes/assistant/[threadId].tsx:148-153` has it.
The preview guard `AsstChat.tsx:5571` hides the whole block when `from` is undefined. Both routes already compute `businessName`, `user`, `profile` identically.

- [ ] RED — e2e: `cypress/e2e/ux-doc-preview.cy.ts` add `it("REQ-NNN NW-06 a conversation started at /assistant shows the From block")`:
      start at `cy.visit("/assistant")` (NOT a thread URL), walk to the review card exactly as the spec's existing case does, assert
      `.quote-review__hero-label` containing the "From" label exists and the hero shows the contractor's email. Run → fails.
- [ ] EDIT `routes/assistant/index.tsx`: between lines 99 and 100 paste lines 148-153 of `[threadId].tsx` verbatim:
      `from={{ business: businessName, name: user?.name, phone: user?.phoneNumber, email: profile?.user?.email }}`.
- [ ] Optional nudge (same task): in `AsstChat.tsx:5587-5598` there is a `fromNeedsName` warning linking to `/settings`; add a sibling
      `!from.email` warning with a new key `asstChat.preview.fromNeedsEmail` ("Add your email in Settings so customers can reply") in both dicts.
- [ ] **Website field: NOT in this task.** It does not exist in the data model (`backend/src/users/dto/business-identity.ts`), Settings, or `PartyCard`.
      It is its own M task — see 7.10.
- [ ] Unit/integration: `n/a — SSR prop plumbing`.

### 1.7 🐛 NW-47 — The starter chip text is never captured as the contractor's name (S) · slug `nw-47-first-turn-name-guard`

**Goal.** Emails/SMS never say "this is I from help me price it".
**Why.** `handle-chat-message/mod.ts:230` runs `extractNameAndBusiness(text)` on the first turn with no job-request guard (its sibling at
`:267` has `!looksLikeJobRequest(text)`). `onboarding/mod.ts:131-187` then splits "I know the job, help me price it" on ", " into
name "I know the job" + business "help me price it"; the SMS uses the first token → "I".

- [ ] RED — Deno unit test: create `backend/src/agents/domain/business/onboarding/test.ts` with `Deno.test` cases:
      `extractNameAndBusiness("I know the job, help me price it.")` → `undefined`; same for "I know my price, write it up.", "Job done, need to invoice.",
      "Just give me a quick quote." and the four Spanish chip strings (copy from `lang/es.json:354-357`); positive control
      `extractNameAndBusiness("Hans Pedersen, Hans LLC")` → `{ name: "Hans Pedersen", businessName: "Hans LLC" }`.
      Run `cd backend && deno test -A --unstable-kv src/agents/domain/business/onboarding/test.ts` → the chip cases fail.
- [ ] RED — Deno int test: `handle-chat-message/int.test.ts` add a case: fresh user, first message = "I know the job, help me price it." →
      after the turn `users.get(id).name` is still the placeholder (not "I know the job"). Run → fails.
- [ ] EDIT `onboarding/mod.ts:162-165`: after the `nameWords` checks add a stop-list guard:
      `const FIRST_WORD_STOP = new Set(["i","we","you","it","my","our","the","this","that","just","job","need","want","know","have","help","give","yo","necesito","quiero","tengo","dame","trabajo"]);`
      `if (FIRST_WORD_STOP.has(nameWords[0].toLowerCase())) return undefined;`
- [ ] EDIT `handle-chat-message/mod.ts:230`: `const userVolunteered = isFirstTurn && !looksLikeJobRequest(text) && extractNameAndBusiness(text);`
- [ ] GREEN: both Deno tests green; `cd jest && npx jest unit/ux-outbound-gate.test.ts` still green.
- [ ] Jest unit/e2e: `n/a — backend-only logic, covered by the Deno tests`.

### 1.8 ◩ NW-23 + 🐛 NW-24 — Start-date options and "Job completed" casing (S) · slug `nw-23-24-start-date-options-casing`

**Goal.** "When does the job start?" offers Right away / Next week / Next month / Pick a date (no "Job Completed"). Everywhere else the
phrase is "Job completed" (lowercase c).
**Why.** `terms-wizard-spec/mod.ts:44-48` adds `job_completed` to `start_date`; "Pick a date" (`custom`, `:49`) already exists. Casing lives in
`lang/en.json:890, 928, 941, 2185` and `:930` ("Next Month"). Term values are persisted in English and re-localized by exact-string maps in
`front-end/lib/term-i18n.ts:18-28`, `render-quote-pdf/mod.ts:857-867`, `render-invoice-pdf/mod.ts:701-711` — each already carries both
"Next Month" and "Next month"; none carries "Job completed".

- [ ] RED — Deno unit test: create `backend/src/agents/domain/business/terms-wizard-spec/test.ts`: the `start_date` step's option ids equal
      `["asap","next_week","next_month","custom"]`; the `wraps` step still contains `job_completed`. Run → fails.
- [ ] RED — jest unit: in `jest/unit/i18n-dictionary-consistency.test.ts` add `describe("REQ-NNN NW-24 'Job completed' casing")`: for both dicts,
      `quoteDoc.termValue.jobCompleted`, `termsWizard.wraps.jobCompleted`, `renderQuotePdf.termValue.jobCompleted` equal "Job completed" (en) / "Trabajo terminado" (es);
      `termsWizard.startDate.nextMonth` equals "Next month". Run → fails.
- [ ] RED — e2e: `cypress/e2e/quotes-wizard-navigation.cy.ts` at the start-date step assert `.wiz__opts .wiz-opt` texts are exactly
      Right away / Next week / Next month / Pick a date and `cy.contains("Job Completed").should("not.exist")`. Run → fails.
- [ ] EDIT `terms-wizard-spec/mod.ts:44-48`: delete the `job_completed` option object (keep `wraps`' own at `:61-64`).
- [ ] EDIT `lang/en.json`: `:890`, `:941`, `:2185` → `"Job completed"`; `:930` → `"Next month"`; delete `:928` (`termsWizard.startDate.jobCompleted`) in BOTH dicts (it is now unused).
- [ ] EDIT the three maps: add the line `"Job completed": "<same key as the 'Job Completed' line>",` next to the existing `"Job Completed"` entry in
      `term-i18n.ts:26`, `render-quote-pdf/mod.ts:865`, `render-invoice-pdf/mod.ts:709`. Keep the old entry (old quotes persist the old spelling).
- [ ] GREEN: Deno + jest + Cypress green. Open an OLD quote that has "Job Completed" saved and check the Spanish view still says "Trabajo terminado".

### 1.9 🐛 NW-17 — "Write it myself." gets its period and breathing room (S) · slug `nw-17-write-it-myself-period`

**Why.** `lang/en.json:256` `asstChat.jobOpts.customTitle` = "Write it myself" (no period); the pill `.chat__details-writeself`
(`static/assistant-page.css:8225-8237`) sits directly under the prompt bubble ending in ".", which reads as one run-on line.

- [ ] RED — jest unit: in `jest/unit/i18n-dictionary-consistency.test.ts` add `it("REQ-NNN NW-17 the write-it-myself pill ends with a period")`:
      `en["asstChat.jobOpts.customCta"]` = "Write it myself." and `es[...]` = "Escribirlo yo mismo.". Run → fails (key missing).
- [ ] EDIT: add a NEW key `asstChat.jobOpts.customCta` ("Write it myself." / "Escribirlo yo mismo.") in both dicts; use it at `AsstChat.tsx:4409` (the pill).
      Leave `customTitle` (no period) for the picker tile at `:4186`, where a trailing period would look wrong.
- [ ] EDIT `static/assistant-page.css:8225`: add `margin-top: 8px;` to `.chat__details-writeself`.
- [ ] Done when: the pill reads "✎ Write it myself." on its own line under the bubble.

### 1.10 🐛 NW-30 — Invoice cards show the job name (S) · slug `nw-30-invoice-card-job-name`

**Why.** The card row `InvoicesPage.tsx:1923-1928` shows initials, `{client} · {ref}`, the amount and a stage line. `jobName` is already
on the API row (`backend/src/paperwork/dto/invoice.ts:94-99`) and already used by the detail headline (`:1110`, `:1136`); the FE `Invoice`
type (`front-end/clients/dashboard.ts:98-139`) only exposes it through the index signature.

- [ ] RED — e2e: new `cypress/e2e/invoice-card-job-name.cy.ts`: `cy.loginAs`, `cy.apiCreateCustomer`, `cy.apiCreateInvoice({ customerId, amount: 45000, jobName: "Deck Staining", dueDate: <+30d> })`,
      `cy.visit("/invoices")`, `cy.get("[data-cy=invoice-card-job]").should("contain.text", "Deck Staining")`. Run → fails.
- [ ] EDIT `front-end/clients/dashboard.ts` inside `interface Invoice` (after line 104): `jobName?: string; description?: string;`.
- [ ] EDIT `InvoicesPage.tsx:1925-1927`: after the `qcard__client-name` div insert
      `{inv.jobName ? <div class="qcard__job" data-cy="invoice-card-job">{inv.jobName}</div> : null}`. Add `.qcard__job { font-size:13px; color: var(--fg); margin: 2px 0; }` to the invoices CSS (find where `.qcard__story` is styled).
- [ ] Unit/integration: `n/a — API already returns the field (pinned by invoice-parity.int.test.ts)`.

### 1.11 🐛 NW-34 — Phone numbers format as `(555) 123-4567` while typing (S) · slug `nw-34-phone-input-mask`

**Why.** The as-you-type mask exists three times privately (`LoginForm.tsx:12-18`, `TrialSignup.tsx:11-17`, `LandingScripts.tsx:586-592`) and is
applied to none of the customer inputs: `ClientsPage.tsx:198-204`, `AsstChat.tsx:7809-7816`, the `/invoices` new-customer modal (`newPhone` state at `InvoicesPage.tsx:2342`).
`shared/quote-flow/format-helpers.ts:66-70` only has the display formatter.

- [ ] RED — jest unit: `jest/unit/format-helpers.test.ts` add `describe("REQ-NNN NW-34 formatPhoneInput as-you-type")` using the lazy `fh()` helper:
      `"5"`→`"(5"`, `"512"`→`"(512"`, `"5125"`→`"(512) 5"`, `"5125556"`→`"(512) 555-6"`, `"5125556999"`→`"(512) 555-6999"`, `"15125556999"`→`"(512) 555-6999"`,
      `"512555699912"`→`"(512) 555-6999"` (extra digits dropped), `""`→`""`. Run → fails (not exported).
- [ ] RED — e2e: `cypress/e2e/clients-page-quality.cy.ts` add `it("REQ-NNN NW-34 the phone field masks as you type")`: open the add-customer form,
      type `5125556999` into `input[type=tel]`, assert `.should("have.value", "(512) 555-6999")`. Run → fails.
- [ ] EDIT `shared/quote-flow/format-helpers.ts`: add `export function formatPhoneInput(raw: string): string` = the `LandingScripts.tsx:586-592` body,
      but first run the digits through `tenDigits()` (`:54-59`) so a leading 1 is stripped, then `.slice(0, 10)`.
- [ ] EDIT the three inputs to `value={formatPhoneInput(x)}` (the `onInput` setters stay as they are; the backend's `normalize-phone` already accepts `(512) 555-1234`):
      `ClientsPage.tsx:200`, `AsstChat.tsx:7813`, and the `newPhone` input in `InvoicesPage.tsx` (search `value={newPhone}`).
- [ ] EDIT de-duplicate: `LoginForm.tsx:12-18` and `TrialSignup.tsx:11-17` import `formatPhoneInput` from `shared/quote-flow/format-helpers.ts` and delete the private copies.
      (`LandingScripts.tsx` is a browser script string — leave it.)
- [ ] GREEN: unit + e2e green; `cd cypress && npx cypress run --spec 'e2e/auth-*.cy.ts'` still green.

### 1.12 🐛 NW-36 — Remove the "Who's on your books" chart (S) · slug `nw-36-remove-segments-chart`

**Why.** `customer.segment` is declared (`backend/src/crm/dto/customer.ts:4-5,27-29`) but has zero write sites; the chart always shows everyone as Unsorted.

- [ ] RED — e2e: `cypress/e2e/clients-page-quality.cy.ts` add `it("REQ-NNN NW-36 no segments chart")`: `cy.visit("/clients")` (the URL that spec already uses at `:47`), `cy.get(".csegment2").should("not.exist")`. Run → fails.
- [ ] EDIT `front-end/components/ClientsSections.tsx:238-289`: delete `ClientsSegmentsProps`, `SEGMENT_COLOR`, and `ClientsSegments`.
- [ ] EDIT `front-end/islands/ClientsPage.tsx`: delete the mount at `:159`; delete the `clientsClient.segments()` entry in the `Promise.all` (`:101-103`) and the `segments` destructure/state; remove the now-unused imports.
- [ ] EDIT `front-end/clients/clients.ts`: delete `ClientSegmentRow`, `ClientSegmentsResponse` (`:60-69`) and the `segments:` method (`:78-79`).
- [ ] EDIT `lang/en.json` + `lang/es.json`: delete the seven `clientsSegments.*` keys (`:702-708`). Leave `clientsSeed.segment.*` if the demo seed still uses them (grep first).
- [ ] Leave the backend endpoint (`backend/src/analytics/entrypoints/clients-controller/mod.ts:78-104`) — it has its own e2e test and hurts nothing. Delete `.csegment2*` CSS rules if you find them.
- [ ] GREEN: `cd front-end && deno task build` succeeds; e2e green; `cd jest && npx jest unit/i18n-dictionary-consistency.test.ts` green.

### 1.13 ◩ NW-54 — "Terms and Conditions" heading on web + PDF (S) · slug `nw-54-terms-and-conditions-heading`

**Why.** Web page heads the clause list with `quoteDoc.terms` = "Terms" (`quote-doc.tsx:140`, used at `:457`); the PDF says "Fine print, in plain English"
(`renderQuotePdf.section.finePrint`, `lang/en.json:2165`, drawn at `render-quote-pdf/mod.ts:479`). The same key is also used on the public invoice (`routes/i/[id].tsx:438`).

- [ ] RED — jest unit: `i18n-dictionary-consistency.test.ts` add `it("REQ-NNN NW-54 the clause heading is Terms and Conditions")`:
      `en["quoteDoc.termsAndConditions"]` = "Terms and Conditions", `es[...]` = "Términos y Condiciones", and `en["renderQuotePdf.section.finePrint"]` = "Terms and Conditions" (es "Términos y Condiciones"). Run → fails.
- [ ] RED — e2e: `cypress/e2e/public-quote-signature.cy.ts` add: the `/q/:id` page `cy.contains("Terms and Conditions")` exists and `cy.contains("Fine print").should("not.exist")`. Run → fails.
- [ ] EDIT: add `quoteDoc.termsAndConditions` to both dicts; change `quote-doc.tsx:140` to `terms: tFor(lang, "quoteDoc.termsAndConditions")`;
      change the VALUE of `renderQuotePdf.section.finePrint` in both dicts (key stays). Leave `routes/i/[id].tsx:438` on `quoteDoc.terms` (the invoice grid is not the T&C list).
- [ ] Done when: web and PDF both say "Terms and Conditions" / "Términos y Condiciones". (NW-55 later wraps this section in an expandable `<details>`.)

### 1.14 ◩ Copy fixes from the "COMPLETED" half: governing-law tail, warranty labels, "Scope of Work" (S) · slug `completed-half-copy-fixes`

**Why.** Verified partials on pp. 76-83: the governing-law clause stops at "…where the work is performed." (`lang/*.json:819`, PDF twin `:2129`);
warranty options read "12 months"/"24 months" instead of "1 year"/"2 years" (`:938-939`); clause 2 is titled "Job Details" where the client's list says "Scope of Work".

- [ ] RED — jest unit: `i18n-dictionary-consistency.test.ts` add `describe("REQ-NNN completed-half copy")`: en 819 and 2129 end with
      "without regard to conflict of law rules."; es 819/2129 end with "sin importar las reglas sobre conflicto de leyes."; `termsWizard.warranty.twelveMonths` = "1 year" / "1 año";
      `twentyFourMonths` = "2 years" / "2 años"; `quoteDoc.clause.jobDetails.title` = "Scope of Work" / "Alcance del trabajo". Run → fails.
- [ ] EDIT the values in both dicts (keys unchanged). Also the PDF twin of the clause title (grep `renderQuotePdf.clause.jobDetails.title`).
- [ ] EDIT the three localization maps (`term-i18n.ts:30-33`, `render-quote-pdf/mod.ts` and `render-invoice-pdf/mod.ts` regex tails): add
      `.replace(/\byears\b/gi, "años").replace(/\byear\b/gi, "año")` so a persisted "1 year" still localizes.
- [ ] E2E: extend the NW-54 case in `public-quote-signature.cy.ts` to `cy.contains("without regard to conflict of law rules")`.
- [ ] Done when: unit + e2e green; PDF regenerates with the new clause text (open `/q/:id` → download PDF → read clause 1).

### 1.15 🐛 NW-14 side-find — Customer balance counts every unpaid invoice status (S) · slug `customer-balance-unpaid-statuses`

**Why.** `backend/src/analytics/domain/coordinators/build-customer-cards/mod.ts:113` adds to `balanceCents` only when `status === "pending"`,
but invoices live in `scheduled|draft|sent|viewed|claimed|paid|void` (`dto/invoice.ts:16-23`). A `sent` invoice shows "$0 owed" on `/customers`.

- [ ] RED — Deno int test: `build-customer-cards/int.test.ts` add a case: one `sent` invoice of `50000` → card `balanceCents === 50000`; one `viewed` → same; `void` → 0; `paid` → 0. Run → fails.
- [ ] EDIT `:113`: `const OWED = new Set(["pending","sent","viewed","claimed"]); if (OWED.has(i.status ?? "")) balanceCents += cents;` (keep the credit/deposit branch).
- [ ] GREEN: `cd backend && deno test -A --unstable-kv src/analytics/` green. Jest/e2e `n/a — backend aggregation`.

---

## Phase 2 — One pricing rewrite closes NW-08 + NW-09 + NW-12 (M) · slug `nw-08-09-12-pricing-tiers`

**Goal.** "Help me price it" shows **Competitive / Market / Premium** with the client's definitions, prices for the contractor's ZIP,
and says on screen that prices include labor and materials.
**Why (all three share one prompt).** `prompts.suggestPrices` (`lang/en.json:1773`, byte-identical in `es.json:1773`) hard-codes
`basic/standard/premium` with labels, never receives a location, and never states the materials basis. `suggest-prices/mod.ts:19`
types the tier union, `:78-83` builds ids/labels positionally, `:96-98` lets the model's English `label` override the localized one
(that is the ES leak), `:126-146` are the fallback tiers. The controller `job-details-controller/mod.ts:85-99` passes only
`{userId, raw, lang}` although `BusinessAddressStore` (`postal/city/state`, `users/dto/business-address.ts:4-13`) is one injection away.
Nothing tests this call today (no Deno, jest, or Cypress file mentions it beyond counting three cards).

- [ ] **Step 1 — RED, Deno int test.** Create `backend/src/agents/domain/coordinators/suggest-prices/int.test.ts` (copy the DI setup from
      `handle-chat-message/int.test.ts:1-30`; `StubLLMClient.setHandler(fn)` lets you script the model):
  - [ ] a. handler returns `{"options":[{"tier":"competitive","priceCents":300000,"rationale":"…"},{"tier":"market",…450000},{"tier":"premium",…600000}]}`
        → result `options[i].tier` = `competitive, market, premium`; `options[i].label` = `Competitive, Market, Premium` (en) even if the handler also sent `"label":"Basic"`; `result.basis === "labor_and_materials"`.
  - [ ] b. handler records the request → the system prompt contains `labor AND materials` and the user content contains `Austin, TX 78701` when the input carries `address: { city:"Austin", state:"TX", postal:"78701" }`.
  - [ ] c. handler throws → fallback tiers with the new ids/labels and `basis` present.
  - [ ] Run `cd backend && deno test -A --unstable-kv src/agents/domain/coordinators/suggest-prices/int.test.ts` → fails (old ids).
- [ ] **Step 2 — RED, jest integration.** New `jest/integration/suggest-prices.int.test.ts`: `const s = await contractor("+15125550960")`; set the address
      (`PUT /profile/address` — `backend/src/users/entrypoints/business-address-controller/mod.ts:23-27` — body `{ city:"Austin", state:"TX", postal:"78701" }`);
      `POST /agents/job-details/prices { raw: "Paint 2000 sq ft interior, two coats" }` → 200; `body.options.map(o=>o.tier)` equals `["competitive","market","premium"]`;
      every `label` ∈ {Competitive, Market, Premium}; `body.basis === "labor_and_materials"`. (Under the stub this exercises the fallback path — that is fine, the shape is the contract.) Run → fails.
- [ ] **Step 3 — RED, e2e.** `cypress/e2e/quotes-help-me-price.cy.ts` case at `:49-56`: add `cy.get("[data-cy=pricing-option]").eq(0).should("contain.text","Competitive")`
      (`.eq(1)` Market, `.eq(2)` Premium) and `cy.get("[data-cy=pricing-basis]").should("be.visible")`. Run → fails.
- [ ] **Step 4 — RED, jest unit (dictionary).** `i18n-dictionary-consistency.test.ts`: `en["suggestPrices.tier.competitive"]`="Competitive", `market`="Market", `premium`="Premium";
      es "Competitivo" / "De mercado" / "Premium"; `en["prompts.suggestPrices"]` contains "labor AND materials" and "competitive < market < premium"; `en["prompts.suggestPrices"] === es["prompts.suggestPrices"]` (the prompt stays English in both; the ES directive key `:1774` handles language). Run → fails.
- [ ] **Step 5 — EDIT the prompt** (`lang/en.json:1773`, then paste the identical value into `lang/es.json:1773`). Replace the whole value with this (keep it as one JSON string with `\n`):

  ```
  You are a pricing assistant for a small contractor. Given a raw job description and the contractor's location, propose THREE prices the contractor can choose between.

  OUTPUT — JSON only, no prose, no code fences:
    { "options": [
      { "tier": "competitive", "priceCents": <int>, "rationale": "<≤12 words>" },
      { "tier": "market",      "priceCents": <int>, "rationale": "<≤12 words>" },
      { "tier": "premium",     "priceCents": <int>, "rationale": "<≤12 words>" }
    ] }

  TIER MEANINGS (never describe a tier as lower quality, less prep, or less work):
  - competitive: a price-conscious bid for when the job is straightforward and winning the work is the priority.
  - market: the typical professional price for this type of work in the contractor's area.
  - premium: appropriate for urgent scheduling, difficult access, higher service expectations, or other job complexity.

  RULES:
  - Exactly 3 options, ascending price: competitive < market < premium.
  - priceCents is an integer number of cents (e.g. $850.00 → 85000).
  - Prices INCLUDE labor AND materials unless the description says the customer supplies materials.
  - Price for the contractor's market: use the location line (city, state, ZIP) to set local labor and material rates. Never fall back to a national average when a location is given.
  - Work from the quantities stated (square footage, coats, openings, linear feet, fixtures, hours). Do not invent quantities. If none are given, price a typical small residential job of this type and say so in the rationale.
  - rationale is ≤12 words, plain, no hype, no emojis, and never words like "basic", "minimal", or "cheap".
  - Return JSON only.
  ```

- [ ] **Step 6 — EDIT `suggest-prices/mod.ts`:**
  - [ ] `:8-15` input gains `address?: { city?: string; state?: string; postal?: string }`.
  - [ ] `:19` → `tier: "competitive" | "market" | "premium"`; `:28-30` result gains `basis: "labor_and_materials"`.
  - [ ] `:56-62` user content → `Raw job description:\n${raw}\n\nContractor location: ${[city, state].filter(Boolean).join(", ")} ${postal ?? ""}`.trim() + langLine (omit the location line entirely when all three are empty).
  - [ ] `:78-83` `tiers = ["competitive","market","premium"]`, labels from `suggestPrices.tier.competitive|market|premium`.
  - [ ] `:96-98` **always** use `labels[out.length]` — ignore the model's `label` (the fixed label is the product; the model gives numbers and rationale).
  - [ ] `:126-146` fallback: new ids, labels, and rationales from `suggestPrices.fallback.competitiveRationale|marketRationale|premiumRationale`.
  - [ ] Return `{ options, basis: "labor_and_materials" }` from both branches.
- [ ] **Step 7 — EDIT the controller** `job-details-controller/mod.ts`: import `BusinessAddressStore` from `@profile/domain/data/business-address-store/mod.ts`, add
      `private addresses: BusinessAddressStore` to the constructor (`:66-75`), and in `suggestPrices` (`:92-98`) pass
      `address: await this.addresses.get(user.id).then(a => a ? { city: a.city, state: a.state, postal: a.postal } : undefined).catch(() => undefined)`.
      (`StartOnboardingConversation` already injects the same store, so DI resolves.)
- [ ] **Step 8 — EDIT lang keys** (both dicts): rename `suggestPrices.tier.basic→competitive`, `standard→market` (premium stays); values above. Replace the three
      `suggestPrices.fallback.*Rationale` with the client's definitions shortened: competitive "Straightforward job, priced to win the work" / market "Typical professional price in your area" / premium "For urgency, difficult access, or extra complexity"
      (es: "Trabajo sencillo, precio para ganar la obra" / "Precio profesional típico en tu zona" / "Para urgencia, acceso difícil o más complejidad").
      Add `suggestPrices.basis.laborAndMaterials`: "Prices include labor and materials" / "Los precios incluyen mano de obra y materiales".
- [ ] **Step 9 — EDIT the tier cards** `AsstChat.tsx:4782-4786`: above the `priceSuggestions === null` ternary add
      `<div data-cy="pricing-basis" class="chat__price-basis">{tFor(lang, "suggestPrices.basis.laborAndMaterials")}</div>` (style: 12px muted). The type at `:616-620` gets `tier: "competitive"|"market"|"premium"` for honesty (it is `string` today — fine to leave).
- [ ] **Step 10 — model quality (optional, same task).** `openai/mod.ts:17` defaults to `gpt-4o-mini`. If the client's $3k/$4.5k/$6k comparison still looks low after the prompt,
      set `OPENAI_MODEL=gpt-4o` in the deploy env (affects every call) — or add a `model` override on `LLMRequest` and pass `"gpt-4o"` from `SuggestPrices` only. Record which in `requirements.md`.
- [ ] **GREEN:** Steps 1-4 pass; `cd cypress && npx cypress run --spec e2e/quotes-help-me-price.cy.ts` and `e2e/ux-help-me-price.cy.ts` green.
- [ ] **Done when:** with a real key and a saved Austin address, "Paint 2000 sq ft interior, two coats, baseboards, crown, 12 door jambs, 15 windows, all ceilings" produces three cards labelled
      Competitive/Market/Premium, a visible "Prices include labor and materials" line, and numbers in the same ballpark as the client's Claude/ChatGPT comparison ($6.5k–$16k). Record the three numbers in the commit body.

---

## Phase 3 — The contractor can say "payment received" (root cause #4) — closes NW-27, NW-31b, NW-32, NW-33; then NW-29, NW-31a, NW-31c

Backend facts to lean on: `POST /payments` (`payment-controller/mod.ts:22-30`) validates `{invoiceId, amount (cents), method, receivedAt, reference?}`
against nine methods (`dto/payment.ts:7-17`) and re-runs `ComputeInvoiceBalance` (`compute-invoice-balance/mod.ts:34-54`), which flips the invoice
to `paid` when the balance hits zero. The front-end client (`front-end/clients/payments.ts:35-41`) is read-only; `InvoicesPage.tsx` never posts a payment;
"Okay, I got it" (`doConfirmReceived`, `:1621-1634`) only works from a customer claim (`confirm-payment/mod.ts:59-62`). `/payments` (`PaymentsPage.tsx:269-277`)
just lists `GET /payments`, so it is empty until a Payment row exists.

### 3.1 ⬜ NW-27 + NW-32 — "Payment received" on Out-for-payment / Overdue / Awaiting (M) · slug `nw-27-payment-received`

- [ ] RED — jest integration: new `jest/integration/payment-received.int.test.ts`: `contractor("+15125550961")`, `seedInvoice(s, { amount: 50000, status: "sent", issuedDate: today })`,
      `POST /payments { invoiceId, amount: 50000, method: "zelle", receivedAt: now }` → `< 400`; `GET /invoices/:id` → `status "paid"`, `paidAt` set;
      `GET /payments?invoiceId=<id>` → one row with `method "zelle"`. **This will pass on arrival** (backend is built) — keep it as the contract pin and say so in the commit.
      Add a second case: partial `amount: 20000` → invoice status is NOT `paid` and `GET /payments` shows the row.
- [ ] RED — e2e: `cypress/e2e/invoice-detail-panel.cy.ts` add `describe("REQ-NNN NW-27 payment received")`: seed a `sent` invoice via `cy.apiCreateInvoice`, `cy.visit("/invoices")`,
      open its card (the spec shows how), click `[data-cy=invoice-payment-received]`, click `[data-cy=pay-method-zelle]`, leave the amount (prefilled), click `[data-cy=pay-received-submit]`;
      after reload the card is in the Paid track (`[data-cy=invoice-back-cta-paid]` exists) and `cy.visit("/payments")` lists a row containing "Zelle". Run → fails.
      **Watch `:94`** ("exactly ONE solid/primary button in the action row") — style the new button with `secondaryBtn`.
- [ ] EDIT `front-end/clients/payments.ts`: add `create: (body: { invoiceId: string; amount: number; method: PaymentMethod; receivedAt: string; reference?: string }, opts: ApiOptions = {}) => api.post<Payment>("/payments", body, opts)`.
- [ ] EDIT new component `front-end/components/PaymentReceivedForm.tsx` (props: `invoice`, `lang`, `onSaved`, `onCancel`): method chips for all nine `PAYMENT_METHODS`
      (copy the chip markup from `PublicInvoiceClaim.tsx:148-167`, labels from `InvoicesPage.tsx:74 methodLabel`), amount `MoneyInput` prefilled with `invoice.amount`,
      date input default today, optional reference, submit → `paymentsClient.create(...)`. `data-cy`: `pay-method-<method>`, `pay-received-amount`, `pay-received-date`, `pay-received-submit`.
- [ ] EDIT `InvoicesPage.tsx`:
  - [ ] detail panel action row `:1155-1180`: add `<button data-cy="invoice-payment-received" style={secondaryBtn} onClick={() => switchMode("pay")}>` for stages `out | overdue | claimed`;
        `mode === "pay"` renders `<PaymentReceivedForm … onSaved={() => { onChanged(); onClose(); }} />`.
  - [ ] card-back `:2299-2314` (out/overdue): add the same button before Mute (it opens the detail panel in `pay` mode — reuse whatever opens the panel today).
  - [ ] front CTA map `:1576-1586`: for `out` change the CTA text key to `invoicesPage.cta.outReceived` ("Payment received →") and route `ctaAction` (`:1726-1732`) for `out` to open pay mode; "View invoice" stays on the card back.
- [ ] EDIT lang (both dicts): `invoicesPage.detail.paymentReceivedBtn` "Payment received" / "Pago recibido"; `invoicesPage.cta.outReceived`; `invoicesPage.pay.title` "How did they pay?" / "¿Cómo pagaron?";
      `.amountLabel`, `.dateLabel`, `.referenceLabel`, `.submit` ("Record payment" / "Registrar pago").
- [ ] `confirm-payment/mod.ts:59-62` is left alone: the claimed path keeps "Okay, I got it" (mints from the intent); the new button is the alternative when the customer never clicked "I sent it".
- [ ] GREEN: both tests; `cd cypress && npx cypress run --spec 'e2e/invoice-*.cy.ts'` green (P-31/P-41 untouched).
- [ ] Done when: an "Out for payment" invoice can be marked paid with a method, lands in the Paid track, and appears on `/payments` — NW-32 closes with no extra work.

### 3.2 ◩ NW-33 — "Record a payment" and "Export" on /payments do real things (S) · slug `nw-33-payments-hero-actions`

**Why.** `PaymentsPage.tsx:558-575` links both buttons to `/assistant?seed=…`, which only pre-fills the composer (`AsstChat.tsx:1298-1306`). `GET /invoices/export.csv?year=` exists (`invoice-controller/mod.ts:313-320`, year only).

- [ ] RED — e2e: new `cypress/e2e/payments-record.cy.ts`: seed a sent invoice, `cy.visit("/payments")`, click `[data-cy=payments-record]`, pick the invoice in `[data-cy=payments-record-invoice]`,
      chip `[data-cy=pay-method-cash]`, submit → the table shows a Cash row. Also `cy.get("[data-cy=payments-export]").should("have.attr","href").and("match", /\/api\/invoices\/export\.csv\?year=\d{4}&month=\d{1,2}/)`. Run → fails.
- [ ] RED — jest integration: `POST /invoices` two invoices with `issuedDate` in different months → `GET /invoices/export.csv?year=YYYY&month=MM` contains only the matching one. Run → fails (no month filter).
- [ ] EDIT `invoice-controller/mod.ts:313-320`: add `@Query("month") monthQ?: string` and filter rows whose `issuedDate` (fallback `createdAt`) month matches when given.
- [ ] EDIT `PaymentsPage.tsx:558-575`: "Record a payment" → `<button data-cy="payments-record">` opening a modal = invoice `<select data-cy="payments-record-invoice">` of unpaid invoices (from `dashboardClient.invoices()`) + `<PaymentReceivedForm>`; on save refetch the list.
      "Export this month" → `<a data-cy="payments-export" href={`/api/invoices/export.csv?year=${y}&month=${m}`} download>`. Delete `paymentsPage.hero.recordSeed`/`exportSeed` keys from both dicts.
- [ ] Done when: both buttons work without leaving `/payments`.

### 3.3 ◩ NW-29 — When an invoice becomes paid, the customer gets the invoice marked PAID (M) · slug `nw-29-paid-invoice-email`

**Why.** `confirm-payment/mod.ts:78-131` emails a *receipt* PDF (only on the claim path, only if `customer.email`); `compute-invoice-balance/mod.ts:46-51` and
`invoice-controller` `PUT status` email nothing. `send-paperwork-email/mod.ts:31` knows `"quote" | "invoice"` only; its invoice template already localizes a status row
(`:1338-1346`, `email-format.ts:76-90` has "Paid"/"Pagado") but the money card says AMOUNT DUE (`:1351-1358`).

- [ ] RED — Deno int test: `send-paperwork-email/int.test.ts` (extend or create): `run(userId, { kind:"invoice", resourceId, variant:"paid" })` → the captured email subject contains "Paid" and the HTML contains "PAID" and not "AMOUNT DUE". Run → fails (no `variant`).
- [ ] RED — jest integration: `jest/integration/ux-payment-receipt.int.test.ts` add a case: seed → `POST /payments` full amount → the comms trail (that file already reads it — copy) has an `email` row whose content mentions the invoice id and "Paid"/"Pagado". Run → fails.
- [ ] EDIT `send-paperwork-email/mod.ts`: `SendPaperworkEmailInput` gains `variant?: "paid"`; when set, subject uses new key `paperworkEmail.invoicePaid.subject` ("Paid — invoice #{id} from {businessName}" / "Pagada — factura #{id} de {businessName}"),
      the money card label becomes `paperworkEmail.invoice.paidLabel` ("PAID {date}" / "PAGADA {date}"), and `RenderInvoicePdf` is called with `{ paid: true }` (add that flag: draw a "PAID" eyebrow where `render-invoice-pdf` draws the status).
- [ ] EDIT new coordinator `backend/src/paperwork/domain/coordinators/mark-invoice-paid/mod.ts`: `run(userId, invoiceId)` → `SendPaperworkEmail` paid variant (best-effort, logged via `LogPaperworkMessage`).
      Call it from `compute-invoice-balance/mod.ts:46-51` when `desiredStatus === "paid" && invoice.status !== "paid"`, and from `confirm-payment/mod.ts:78-81` after the flip (keep its receipt too). Register in `paperwork/mod-root.ts`.
- [ ] GREEN: Deno + jest; `ux-payment-receipt.int.test.ts` old cases still green. E2E `n/a — email content`.

### 3.4 ◩ NW-31a — "Awaiting confirmation" gets a real nudge; "Send nudge" uses the reminder cadence (S) · slug `nw-31a-invoice-nudge`

**Why.** `cron-controller/mod.ts:55-64` `POST /cron/invoice-reminder { invoiceId, day∈{3,7,14,30} }` is documented as the button's backend but has zero FE callers;
"Send nudge" (`doSendText`) re-texts the whole invoice (`paperwork-email-controller:163`). The claimed card back has only "Didn't get it" / "Text client" (`InvoicesPage.tsx:2288-2319`).

- [ ] RED — jest integration: `POST /cron/invoice-reminder { invoiceId: <claimed invoice>, day: 3 }` → 200 with a comms-trail row. Run; if it refuses `claimed` invoices, that refusal is the red — relax the status gate in `SendPaymentReminder.runForInvoice` to allow `sent|viewed|claimed`.
- [ ] RED — e2e: claimed card back has `[data-cy=invoice-nudge]`; `cy.intercept("POST","/api/cron/invoice-reminder").as("nudge")` → click → `cy.wait("@nudge")`. Overdue front CTA "Send nudge" also hits `@nudge`. Run → fails.
- [ ] EDIT `InvoicesPage.tsx`: new `doSendNudge` → `fetch("/api/cron/invoice-reminder", { method:"POST", body: JSON.stringify({ invoiceId: inv.id, day }) })` with `day` = 3 if `daysOverdue<=3`, 7 if `<=7`, 14 if `<=14`, else 30;
      `ctaAction` for `overdue` → `doSendNudge` (was `doSendText`); claimed card back gets `<button data-cy="invoice-nudge" onClick={doSendNudge}>` labelled `invoicesPage.back.nudge` ("Send a nudge" / "Enviar recordatorio").
- [ ] Done when: both nudges post to the cadence endpoint and show a "Nudge sent" toast (reuse the existing send-fail/ok pattern at `:1686-1688`).

### 3.5 ◩ NW-31c — Upcoming invoices: pick a send date; nudge the Dragon when it is due (M) · slug `nw-31c-schedule-send`

**Why.** `scheduledFor` is read-only in the FE (sort `:389`, subline `:1606`); `NewInvoiceModal` has `dueDate` (`:2345-2349`) but no `scheduledFor`; the backend accepts it (`CreateInvoiceDto:127`);
`POST /cron/run-nudges` (`cron-controller:46-51`) would ping the contractor but nothing calls it.

- [ ] RED — jest integration: `POST /invoices { …, scheduledFor: <tomorrow>, status: "scheduled" }` → `POST /cron/run-nudges` → `count >= 1`. Run → likely passes (backend built) — pin it. Then `PUT /invoices/:id { scheduledFor: <+10d> }` → `GET` reflects it.
- [ ] RED — e2e: `NewInvoiceModal` has `[data-cy=invoice-schedule-date]`; creating with it puts the card in the Upcoming track with "Scheduled to send <date>"; the Upcoming card back has `[data-cy=invoice-change-date]` that PUTs a new date. Run → fails.
- [ ] EDIT `NewInvoiceModal` (`InvoicesPage.tsx:2338+`): add "Send on" date input → body `{ scheduledFor, status: "scheduled" }` when set.
- [ ] EDIT Upcoming card back: "Change date" → inline date input → `PUT /invoices/:id { scheduledFor }` → refresh.
- [ ] EDIT `InvoicesPage.tsx` mount effect: fire-and-forget `fetch("/api/cron/run-nudges", { method: "POST" })` once per page load (idempotent server-side) so a due scheduled invoice produces the "approve that the job is done and send the final invoice" nudge in the assistant. (A real scheduler is a deploy decision — note it under §8.)
- [ ] Done when: an invoice can be created "to send on <date>", the date can be changed, and visiting `/invoices` on/after that date produces the nudge.

---

## Phase 4 — The invoice starter goes through the quote wizard (root cause #7) — closes NW-13, NW-14, NW-15, NW-16, NW-18 (L)

**Model to build toward (this is what the client described, and it reuses everything that exists).** The wizard always produces an agreement
row (a quote). An invoice is *derived* from it (`POST /invoices { quoteId }` → `invoice-controller/mod.ts:213-224` fills job name, description,
customer, line items, amount; the public `/i/:id` then shows terms, dates and the signed-quote link — `public-controller/mod.ts:707-733`).
So "Job done, need to invoice" = (a) if an accepted quote is picked, skip straight to the shared review in invoice mode; (b) otherwise run the
same wizard with `completion_date` in place of `wraps`, land on the same review, and send the invoice from it. The standalone cards at
`AsstChat.tsx:4577-4728` and `createInvoiceFromFlow`/`saveInvoiceFromReview` (`:3333-3458`) go away.

Do 4.1 first (independent, medium); 4.2 is the large one; 4.3 is cleanup.

### 4.1 ⬜ NW-14 + NW-15 — Picking an accepted job skips to a seeded review (M) · slug `nw-14-15-invoice-from-accepted-quote`

**Why.** The chips built at `AsstChat.tsx:3307-3311` keep only `{jobName, customerName, totalCents}` — `c.id` and `c.customerId` are dropped — so the click
handler (`:4382-4392`) can only prefill a *name string* and reopen "What's the price?" (`asstChat.price.whatTitle`). Both `POST /invoices` bodies (`:3431-3439`, `:3478-3486`) omit `quoteId`.

- [ ] RED — e2e: `cypress/e2e/ux-invoice-review.cy.ts` add `describe("REQ-NNN NW-14/15 invoice from an accepted quote")`: `cy.seedQuoteToCash()` (creates customer + quote), `cy.apiAcceptQuote(quoteId, { signature… })`,
      `cy.visit("/assistant")`, click the chip "Job done, need to invoice.", click `.chat__accepted-job` (first), then: `cy.contains("What's the price?").should("not.exist")`;
      `[data-cy=invoice-quote-summary]` shows the job name, the customer name, the total, "Billed so far" and "Paid so far" lines; click `[data-cy=invoice-flow-save]` (or the review's send button);
      `cy.request("/api/invoices")` → newest has `quoteId === <seeded id>` and `lineItems.length > 0`. Run → fails.
- [ ] RED — jest integration: `invoice-parity.int.test.ts` add `it("REQ-NNN POST /invoices with only quoteId derives amount, customer, lineItems")` (may pass on arrival — pin it).
- [ ] RED — jest unit: `jest/unit/invoice-from-quote.test.ts` add a case that `buildInvoiceFromQuote(quote)` output can be spread into the POST body: `{ quoteId, lineItems, customerId }` present. (Extend `shared/quote-flow/invoice-from-quote.ts:32-47` to also emit `customerId: quote.customerId`.)
- [ ] EDIT `AsstChat.tsx:3287-3313`: keep `id: c.id` and `customerId: c.customerId` on the chip objects (widen the `acceptedJobChips` state type).
- [ ] EDIT the chip click (`:4382-4392`): instead of `setPriceCaptureOpen(true)`: `pushHistory()`; `const q = await quotesClient.get(j.id)`; `setPendingPriceCents(q.estimatedTotal)`;
      `setInvoiceReview({ quoteId: q.id, customerId: q.customerId, customerName, custEmail, custPhone, lineItems: q.lineItems, terms: q.terms, jobName: q.jobName })`; also fetch
      `api.get("/invoices")` and filter by `quoteId` client-side → `billedTotalCents(existing)` (`shared/quote-flow/milestone-reconcile.ts:23-32`) and `paidTotal` = sum of `status==="paid"` siblings.
- [ ] EDIT the review card (`:4676-4728`): render `[data-cy=invoice-quote-summary]` (job name, line items, terms grid via the existing `TermGrid`, Billed so far / Paid so far / This invoice), make the amount an editable `MoneyInput` (default = agreement total − billed), keep the due-date input.
- [ ] EDIT `saveInvoiceFromReview` (`:3431-3439`) and `confirmSendInvoiceSwap` (`:3478-3486`): spread `buildInvoiceFromQuote(quote)` → `{ quoteId, lineItems, customerId, jobName, description }` and drop `status:"sent"` (the send endpoints stamp it).
- [ ] GREEN: all three; `invoice-parity.cy.ts` green (the `/i/:id` page now gets terms for chat-made invoices too).
- [ ] Done when: picking an accepted job never asks for the price or the customer again, and the saved invoice is linked to the quote.

### 4.2 🐛 NW-13 + NW-18 + NW-16 — A brand-new invoice runs the wizard (customer → completion date → payment → warranty) and lands on the shared preview (L) · slug `nw-13-18-invoice-wizard`

**Why.** `onPriceContinue` (`AsstChat.tsx:1861-1866`) returns before the wizard when `invoiceFlow`; the wizard spec is one hard-coded constant
(`terms-wizard-spec/mod.ts:19-125`) referenced directly by five coordinators (`handle-wizard-answer:99,127,134,161,372`, `transition-to-terms:53-96`,
`rewind-wizard:67,93,117`, `load-conversation:57`); `wizard-progress/mod.ts` is a linear cursor with no per-flow filtering. There is no `completion_date` step or key.

- [ ] **Backend, step A — a second spec.** RED Deno unit test in `terms-wizard-spec/test.ts` (created in 1.8): `INVOICE_WIZARD_V1.steps.map(s=>s.id)` equals `["customer","completion_date","payment_terms","warranty"]`;
      `getWizardSpec("invoice-v1")` returns it; `completion_date` options are `today | yesterday | last_week | custom(isCustom)`. Run → fails.
  - [ ] EDIT `terms-wizard-spec/mod.ts`: add `INVOICE_WIZARD_V1 = { id: "invoice-v1", steps: [ <customer step object copied>, { id:"completion_date", label:"termsWizard.completionDate.label", question:"termsWizard.completionDate.question", options:[ {id:"today",label:"termsWizard.completionDate.today"}, {id:"yesterday",…}, {id:"last_week",…}, {id:"custom",label:"termsWizard.completionDate.custom",isCustom:true} ] }, <payment_terms copied>, <warranty copied> ] }`;
        `getWizardSpec` (`:128-131`) resolves both ids.
  - [ ] EDIT lang (both dicts): `termsWizard.completionDate.label` "Completed" / "Terminado"; `.question` "When was the job completed?" / "¿Cuándo se terminó el trabajo?"; `.today` "Today" / "Hoy"; `.yesterday` "Yesterday" / "Ayer"; `.last_week` "Last week" / "La semana pasada"; `.custom` "Pick a date" / "Elegir una fecha".
- [ ] **Backend, step B — coordinators resolve the spec from state.** RED Deno int test `transition-to-terms/int.test.ts`: `run({ conversationId, userId, docKind: "invoice" })` → wizard state `specId === "invoice-v1"` and the first wizard message's payload `specId` matches. Run → fails.
  - [ ] EDIT `transition-to-terms/mod.ts`: input gains `docKind?: "quote" | "invoice"`; pick the spec with it; persist `docKind` on the conversation (add the field to `AgentConversation` DTO + store) so the FE can preset the review.
  - [ ] EDIT the other four: replace every `TERMS_WIZARD_V1` with `getWizardSpec(state.specId)` where a `WizardState` is in hand (`handle-wizard-answer:99,127,134,161,372`, `rewind-wizard:67,93,117`, `load-conversation:57`). `rewind-wizard:67` (the no-state branch) can keep `TERMS_WIZARD_V1.id`.
  - [ ] EDIT `handle-wizard-answer` `finalizeTerms`: when the answer is `completion_date`, write `estimatedCompletionDate`/`completedAt` on the quote (add `completedAt?: string` to the quote DTO if absent) and let `payment_terms.due_now` set the invoice due date = completion date, `net_15` = +15 days, others = +30.
  - [ ] Add an `int.test.ts` case in `handle-wizard-answer` walking all four invoice steps → `continue_cta` with `quoteId` and `docKind: "invoice"` in the payload.
- [ ] **Front-end, step C — route the chip through the wizard.** RED e2e: rewrite `cypress/e2e/ux-invoice-review.cy.ts` UX-31 cases into `describe("REQ-NNN NW-13/18 new invoice runs the wizard")`:
      chip "Job done, need to invoice." → type details → send → price → `.chat__price-continue` → customer step (`cy.openCustomerCreateForm()` …) → completion-date step shows Today/Yesterday/Last week/Pick a date and **no** "How long will the job take?" →
      payment step → warranty step → `.quote-review` visible with the **invoice** pill active (`.quote-review__langpill.is-active` contains the invoice label) → send (email) → `cy.request("/api/invoices")` newest has `quoteId`, `dueDate` = completion date when "Due Now" was picked; `cy.visit("/i/<id>")` shows the term grid (`invoice-parity.cy.ts` assertions). Run → fails.
  - [ ] EDIT `AsstChat.tsx:1861-1866`: delete the `if (invoiceFlow) { openInvoiceCustomerStep(); return; }` early return; `startQuoteFromRaw(raw, cents)` gains a `docKind` argument = `invoiceFlow ? "invoice" : "quote"` and passes it to `assistantClient.transitionToTerms(convId, { docKind })` (extend `front-end/clients/assistant.ts` + the controller body parsing).
  - [ ] EDIT the auto-open effect (`:1583-1595`) / `submitContinueCta`: when the CTA payload has `docKind:"invoice"` (or the conversation does), `setReviewDocType("invoice")` before opening the review.
  - [ ] EDIT `confirmSendInvoiceSwap` (`:3467-3540`): it is now the invoice send path — body from 4.1 plus `dueDate` from the wizard answer (read it off the quote's terms), never `today` by default.
  - [ ] The customer step's "Use the customer from chat" (`use_active`) should work for invoices too — nothing to change once the wizard is shared.
- [ ] **GREEN:** Deno tests (`cd backend && deno task test`), e2e above, `quotes-wizard-navigation.cy.ts`, `ux-assistant-single-back.cy.ts`, `assistant-history.cy.ts` (back through the invoice wizard uses the same stack).
- [ ] **Done when:** the invoice path asks customer / completion date / payment / warranty, previews the same document with the invoice pill on, and the public invoice shows terms and job details.

### 4.3 Cleanup after 4.2 (S) · same worktree as 4.2 or slug `nw-13-cleanup`

- [ ] Delete the standalone success/review cards `AsstChat.tsx:4577-4728`, `createInvoiceFromFlow` `:3333-3410`, `saveInvoiceFromReview` `:3414-3458`, `openInvoiceCustomerStep` `:3318-3324`, the `invoiceCustomerOpen`/`invoiceReview`/`invoiceResult` state and their entries in `pushHistory`/`popHistory`/`composerHidden` (`:1034-1053`, `:1063-1077`, `:7262-7266`), and `resolveAssistantBack`'s `invoiceResultOpen` (`shared/quote-flow/assistant-back.ts:23,48` + its unit test case at `jest/unit/assistant-back.test.ts:52-58`).
- [ ] Delete lang keys `asstChat.invoiceFlow.readyTitle|readySub|sendNow|viewInvoice|goToInvoices|reviewTitle|saveCta|noAmount|needCustomer|noContact|dueDateLabel` (`lang/*.json:238-248`) once nothing references them (`grep -rn "asstChat.invoiceFlow" front-end shared`).
- [ ] Update `TDD-QUOTE-FLOW.md` row 5 and `TESTS-UX-PROBLEMS.md` UX-31 to point at the new spec.
- [ ] Verify: `cd front-end && deno task build`; full Cypress `run:assistant` + `run:invoice` green.

---

## Phase 5 — Never echo the contractor's sentence back (root cause #6) — closes NW-05, NW-11 (L) — **do Phase 0 first**

**Why.** Three places echo raw text: backend `generate-job-options/mod.ts:236-272` `fallbackOptions` (bullets = the raw sentences; `clampJobName` `:212-220`
→ "I Need To"), backend `polish-job-details/mod.ts:152-161` (`description: raw`), and front-end `AsstChat.tsx:223-252` `localFallbackOptions`, which
is painted **before** the request at `:1898-1903` and `:1937-1942` (`setOptionsLoading(false)` first, so the "Writing up your options…" spinner at
`:3896-3906` is dead). The prompt `prompts.polishJobDetails.system` (`lang/*.json:1771`) even says "mirror it back cleaned-up". Under the stub LLM
(Phase 0) every call takes this path; under a real key it still flashes first and still happens on timeout.

Tests that currently *depend* on the echo and must keep passing or be consciously updated: `jest/integration/ux-job-name.int.test.ts:153-191`
(they assert job names that are word-windows of the input — they survive if the rewrite only strips intent prefixes and price clauses),
`jest/unit/ux-job-name-es.test.ts` (pure, unaffected), `cypress/e2e/ux-help-me-price.cy.ts:71` (waits 20 s for `[data-cy=confirm-details]` — still fine).

### 5.1 Honest scope bullets from raw text (pure helper, both fallbacks) (M) · slug `nw-05-scope-from-raw`

- [ ] RED — jest unit: new `jest/unit/scope-from-raw.test.ts` for a new module `shared/quote-flow/scope-from-raw.ts` exporting `scopeBulletsFromRaw(raw: string, lang: "en"|"es"): { bullets: string[]; degraded: boolean }`:
  - [ ] `"I need to replace a toile for $500"` → bullets `["Replace a toile"]` (intent prefix "I need to" removed, price clause removed, first letter capitalized, no trailing period), `degraded:false`.
  - [ ] `"Necesito cambiar 12 tablas del deck por $900"` → `["Cambiar 12 tablas del deck"]`.
  - [ ] `"Customer wants a 10x10 slab, what should I charge?"` → `["10x10 slab"]` (question tail removed).
  - [ ] `"paint fence; haul debris\nclean up"` → three bullets.
  - [ ] `"ok"` (nothing left after stripping) → `bullets: []`, `degraded: true`.
  - [ ] Invariant on every case: no bullet `=== raw.trim()`, no bullet contains `$`, none starts with `/^(I|we|necesito|quiero)\b/i`.
      Run `cd jest && npx jest unit/scope-from-raw.test.ts` → fails (module missing).
- [ ] RED — Deno int test `generate-job-options/int.test.ts` (new; DI like `handle-chat-message/int.test.ts`, use `StubLLMClient.setHandler`):
      (a) handler throws → options exist, no bullet equals the raw sentence, none contains "$500", `result.degraded === true`; (b) handler returns valid JSON → passthrough, `degraded` false;
      (c) default stub echo `"(stub) …"` → same as (a). And `polish-job-details/int.test.ts`: fallback `description` is the joined bullets, not `raw`.
- [ ] EDIT `shared/quote-flow/scope-from-raw.ts`: strip `^(i|we|customer|client|they)\s+(need|needs|want|wants)\s+(to\s+)?` and es `^(necesito|necesitamos|quiero|queremos|el cliente quiere)\s+`, strip `(for|por|,)?\s*\$\s?[\d,]+(\.\d+)?(\s*(total|todo incluido))?`, strip `,?\s*what should I charge\??$`, split on `[\n;.]`, capitalize, dedupe; `degraded` when no bullet survives.
- [ ] EDIT `generate-job-options/mod.ts:236-272`: `base = scopeBulletsFromRaw(raw, primary).bullets` (fallback to `[t(lang,"generateJobOptions.newJob")]` when degraded); return `degraded: true` on the fallback path (add to the result type and the controller response). Import via `#quote-flow/scope-from-raw.ts`.
- [ ] EDIT `polish-job-details/mod.ts:152-161`: `description: scopeBulletsFromRaw(raw, lang).bullets.join("\n") || raw`.
- [ ] GREEN: unit + Deno; `cd jest && npx jest integration/ux-job-name.int.test.ts` (dev server up) still green — if a job-name expectation changed, decide per case whether the new name is better (it should be identical for inputs without a prefix or price).

### 5.2 Front-end: spinner first, heuristic only on failure, honest degraded state (S) · slug `nw-11-spinner-before-options`

- [ ] RED — e2e: `cypress/e2e/ux-help-me-price.cy.ts` add: (a) `cy.intercept("POST","/api/agents/job-details/options",{ delay: 1500, fixture… })` → after sending details `.chat__jobopts-loading` is visible before any `[data-cy=confirm-details]`;
      (b) intercept with `statusCode: 500` → `[data-cy=jobopts-degraded]` note visible, the Write-it-myself editor open and prefilled, and no `.chat__jobopts` bullet text equals the typed sentence. Run → fails.
- [ ] EDIT `AsstChat.tsx:1897-1903` and `:1936-1942`: `setOptionsLoading(true)`; do NOT paint the heuristic; after `await`: if `res?.options?.length` → paint them, `setOptionsLoading(false)`; if `res.degraded` → also show the note; on `null` (request failed) → paint `localFallbackOptions` (now built on `scopeBulletsFromRaw`) or, when degraded, open `openWriteMyself()` prefilled with `raw`.
- [ ] EDIT `localFallbackOptions` (`:223-252`) to use `scopeBulletsFromRaw` from `shared/quote-flow/scope-from-raw.ts` (extensionless import like the other shared modules).
- [ ] EDIT lang (both dicts): `asstChat.jobOpts.degraded` "I couldn't draft this one — edit the bullets or write it yourself." / "No pude redactar esto — edita los puntos o escríbelo tú mismo."; render with `data-cy="jobopts-degraded"`.
- [ ] Done when: with the network throttled you see the dots + "Writing up your options…" first, and a forced 500 never shows the sentence back.

### 5.3 Prompts stop licensing the echo (S) · slug `nw-05-prompt-no-verbatim`

- [ ] RED — jest unit (`i18n-dictionary-consistency.test.ts`): `en["prompts.generateJobOptions"]` contains "Never return the contractor's sentence verbatim"; `en["prompts.polishJobDetails.system"]` does NOT contain "mirror it back"; both equal their `es` twins. Run → fails.
- [ ] EDIT `lang/en.json:1763` (and es): append the rule `- Never return the contractor's sentence verbatim as a bullet or summary. Rewrite every bullet as a scope line; drop prices, "I need to", and questions.`
- [ ] EDIT `lang/en.json:1771` (and es): replace the last rule with `- If the raw text is too vague to polish meaningfully, write one neutral scope sentence from the facts given — never the contractor's own sentence.`
- [ ] Done when: the dictionary test passes and a manual run with the toilet sentence gives three rewritten options.

---

## Phase 6 — ❓ Decisions the client must make, with the work each answer unlocks

Send §10 (the message at the bottom) to the client. Do not start these tasks until the answer is back; everything above is unblocked meanwhile.

### 6.1 ❓ NW-02 — Whose contact goes in the customer-doc footer? (S once decided) · slug `nw-02-footer-contact`

The p24 ask (house `hello@paperworkmonster.com` / `866-767-8399`) reverses the p61 item that shipped ("Questions before signing? Call <contractor phone> or email <contractor email>").
Today the footer is one component gated on the contractor having a phone or email: `front-end/components/quote-doc.tsx:696-742` and `front-end/routes/i/[id].tsx:508-548`.

- If **house contact** wins:
  - [ ] RED unit: new `jest/unit/support-contact.test.ts` → `SUPPORT_CONTACT` from `shared/quote-flow/support-contact.ts` equals `{ email: "hello@paperworkmonster.com", phone: "866-767-8399" }` and `telHref(SUPPORT_CONTACT.phone) === "tel:+18667678399"`.
  - [ ] RED e2e: `public-quote-signature.cy.ts` and `invoice-parity.cy.ts`: the footer contains `866-767-8399` and `hello@paperworkmonster.com` even for a contractor with no email on file.
  - [ ] EDIT: create the constants module; in both footers drop the gate and render the house values (keep the `qBefore`/`qSigned` variant switch, `public-doc-state.ts:32-69`); leave `public-controller` and the From block alone.
- If **contractor contact** stays: close NW-02 as "by design, per p61"; no code.

### 6.2 ❓ NW-03 + NW-38 — Remove "Just give me a quick quote"? (S) · slug `nw-38-remove-quick-quote-chip`

It is byte-identical to "I know my price" except the greeting (`AsstChat.tsx:3225-3251`); p35 says "REMOVE THIS", p65's verified copy expects three boxes and four render.

- If **remove** (recommended):
  - [ ] RED unit: `jest/unit/assistant-contracts.test.ts:143-158` → change `KEYS` to the three remaining chips and add `it("REQ-NNN NW-38 quickQuote is not a starter chip")` asserting `chipIntent` throws/undefined for it. RED e2e: `cypress/e2e/quotes-help-me-price.cy.ts:79-85` → replace the `it.skip` with `it("REQ-NNN exactly three starter chips")` → `cy.get("button.chat__empty-prompt").should("have.length", 3)`.
  - [ ] EDIT: delete `AsstChat.tsx:4886-4892` (button) and `:3243-3251` (`startQuickQuoteFlow`); in `shared/quote-flow/starter-chips.ts` drop `"quickQuote"` from `ChipKey` (`:13`), `INTENTS` (`:18`), both `REPLIES` (`:31-32`, `:41-42`); delete `asstChat.prompt.quickQuote` (`lang/*.json:357`); fix the `flowChip` union in `AsstChat.tsx` where TypeScript complains. Keep `quick-quote-prefill.ts` (used by the other starters at `:2439`).
- If **keep**: the client must say what it does differently; then it is a new feature (out of this plan).

### 6.3 ❓ NW-04 + NW-07 — On the job-details step, which input survives: the chat composer or the "Write it myself" box? (M) · slug `nw-04-one-details-input`

Both render today: the composer (`AsstChat.tsx:7262-7286` deliberately keeps it visible and flashes it) and the "✎ Write it myself" pill + editor (`:4402-4432`). Only the box owns "Professionalize that" (`:4505-4535`).
The rest of the roadmap treats the composer as the details input (p60 "input bar", p66 "Talk or type", voice memos live there).

- **Option A (recommended) — keep the composer, delete the step-1 box.** Professionalizing still exists per bullet in the picker (NW-41 ✅) and in the picker's own "Write it myself" tile.
  - [ ] RED e2e: `cypress/e2e/quotes-professionalize.cy.ts:25-27` → after submitting details via the composer, click the picker's "Write it myself" tile and expect `[data-cy=professionalize-btn]` there. `cypress/e2e/ux-help-me-price.cy.ts` gets `cy.get(".chat__details-writeself").should("not.exist")`.
  - [ ] EDIT: delete `:4402-4432` and `openWriteMyself`/`writeMyselfOpen` state if nothing else uses it; if the picker's custom tile editor (`:4163-4200`) lacks the Professionalize button, move the `:4505-4535` block into it. Delete `.chat__details-writeself` CSS (`assistant-page.css:8224-8241`). (This supersedes 1.9.)
- **Option B — keep the box, hide the composer on that step.**
  - [ ] EDIT `:7262`: add `|| (awaitingJobDetails && !submittedJobDetails) || writeMyselfOpen` to `composerHidden`; give the box a mic button (voice currently only lives on the composer, `sendVoice` `:1792`).
  - [ ] RED e2e: `ux-help-me-price.cy.ts:66-69` types into the box instead of `textarea.composer__input`.

### 6.4 ❓ NW-37 — Pricing page: $15 Starter / no Free (p34) or Hans's 2026-08-31 recap (Free $0 / $99 / $199 / custom) that shipped?

`shared/quote-flow/pricing-plans.ts:2-10` documents the recap as the source; commits `6492671`, `a0ec81d`; pinned by `jest/unit/pricing-plans.test.ts:24-38` and `cypress/e2e/landing-pricing.cy.ts:28-75`.
- If it flips back: edit `pricing-plans.ts`, both dicts (`lang/en.json:1366-1396`, `:1737-1751`), and both tests. No "%" anywhere either way. (S/M)

### 6.5 ❓ NW-44 — Badge says "Accepted"; client wrote "Approved". (S) · slug `nw-44-approved-label`

- If **Approved**: RED unit `jest/unit/quote-status.test.ts` (`badgeLabel("accepted","en") === "Approved"`, es "Aprobada") + e2e `quotes-status-badges.cy.ts`. EDIT `shared/quote-flow/quote-status.ts:54-55` `BADGE_LABELS`, `lang/*.json:2447` `quotesPage.status.accepted`, `shared/quote-flow/email-format.ts:78/88` `STATUS_LABELS.accepted`. The persisted value `"accepted"` must NOT change.

### 6.6 ❓ p57 vs p82 — "01 The deal in plain English": delete it (p57) or rename it "Quick Summary" (p82, NW-57)?

Today it renders (`quote-doc.tsx:411`, `quoteDoc.plainEnglish` `lang/*.json:864`), which also pushes Payment Schedule to 03 and Terms to 04. Pick one; the rename is part of 7.8, the delete is a 10-line removal in `quote-doc.tsx` + renumbering.

### 6.7 ❓ NW-55 — Do you want a real invoice number sequence (INV-0001…) or is the derived `#<8 chars of id>` fine?

A stored per-contractor counter is a new field + atomic KV increment in `invoice-store` (M); the derived id is free. Decide before 7.7.

### 6.8 ❓ Need the artefact before anything can be done

- **NW-21 "Yam"** — the string exists nowhere in the repo. Most likely the new-customer *value* was prefilled from your sentence ("…for Yam…" → `extractCustomerName`, `shared/quote-flow/quick-quote-prefill.ts:66-98`). Please send the screenshot or the sentence you typed.
- **NW-53c logo** — send the new artwork (PNG/SVG). `front-end/static/logo-monster.png` is what ships; `components/ui/Brand.tsx` renders a text "P" mark.
- **NW-53g "Quote and Agreement change"** — the bullet is empty; what change?
- **NW-57 "Contract for new job"** — that sentence is not in the code; screenshot please.
- **NW-46 "Quote & Agreement - Final.docx"** — not in the repo; attach it.

### 6.9 ❓ Scope calls (not bugs)

- **NW-51c** Spanish dialects: one neutral-LatAm dictionary today (`tú`, "cotización"). Recommend: declare neutral as the decision (S: a line in `requirements.md`). Locale-tag overrides are L.
- **NW-56** "Keep the ability to draft contracts": there is no standalone contract feature to keep (`/contracts` is a 302 to `/quotes`). Recommend: confirm the quote IS the contract; no work.
- **NW-58** competitor features + easy import: L; needs a competitor list first. Export exists (`GET /invoices/export.csv`).

---

## Phase 7 — Remaining medium items (no decision needed; any order; after Phases 1–5 if time is short)

### 7.1 ◩ NW-22 + NW-35 — Create a customer straight from the assistant dropdown; never a silently disabled Next (S–M) · slug `nw-22-35-customer-create-from-dropdown`

**Why.** The dropdown's text field is a **filter** (`AsstChat.tsx:7957-7964`); no match renders `common.noMatches` with nothing to click (`:7976-7981`); the real create is the separate "+ New customer" button (`:8012-8019`).
Next is disabled with no message when the form is empty or has no phone/email (`:7760-7776`), while the Customers page allows name-only (`ClientsPage.tsx:233-239`). The server-side "own contact" throw (`handle-wizard-answer/mod.ts:263-272`) is a raw English string.

- [ ] RED e2e (`cypress/e2e/ux-assistant-pick-customer.cy.ts`): type "Incredible Hulk" in the dropdown search with no match → `[data-cy=cust-create-from-search]` visible → click → the create form opens with the name prefilled → fill phone → Next → the customer exists on `/customers` (`cy.request("/api/clients")` contains "Incredible Hulk"). Second case: name only, no contact → `[data-cy=cust-contact-hint]` visible with the `needContact` copy (not just a disabled button).
- [ ] RED Deno int (`handle-wizard-answer/int.test.ts`): own-contact create → error is a lang key value (`customerStep.ownContact`), not the raw string.
- [ ] EDIT `:7976-7981`: render `<button data-cy="cust-create-from-search" onClick={() => { openCreate(); setCreateName(search); }}>{tFor(lang,"asstChat.customerStep.createNamed",{name:search})}</button>` ("Create \"{name}\"" / "Crear \"{name}\"").
- [ ] EDIT `:7768-7774`: show `contactErr` (`data-cy="cust-contact-hint"`) whenever `!hasContact`, even with an empty name; keep the disable.
- [ ] EDIT `handle-wizard-answer/mod.ts:269-271`: throw `new Error(t(lang, "customerStep.ownContact"))` with the key in both dicts.

### 7.2 🐛 NW-25 — Reject 555 numbers before Twilio; report each channel honestly (M) · slug `nw-25-sms-honesty`

**Why.** Only shape checks exist (`send-paperwork-sms/mod.ts:365-373`, `users/domain/business/normalize-phone/mod.ts:8-28`); Twilio errors return the raw JSON (`users/domain/data/sms/mod.ts:93-99`);
the invoice page collapses two channels into one boolean (`InvoicesPage.tsx:1494-1499`) and reports only the email reason (`:1504-1513`).

- [ ] RED Deno unit (`normalize-phone/test.ts`): `normalizePhone("(512) 555-0123")` throws `phone_fictional`; `"(512) 655-0123"` passes. (555-01xx is the reserved fictional block; plain 555 exchange numbers also fail Twilio — reject the whole `555` exchange for US numbers.)
- [ ] RED Deno unit (`users/domain/data/sms/test.ts`): a Twilio 400 body with `"code":21211` → `reason: "sms.invalidNumber"` (a lang key), likewise 21610 → `sms.optedOut`, 21614 → `sms.notMobile`.
- [ ] RED jest unit (`jest/unit/send-result.test.ts`): a new pure `summarizeDispatch({ email:{delivered:true}, text:{delivered:false, reason:"sms.invalidNumber"} })` → `{ delivered: true, partial: true, failedChannels:["text"] }`.
- [ ] RED e2e (`cypress/e2e/invoice-send-honesty.cy.ts`): customer phone `+15125550100` → send "Text + Email" → the page says the email went and the text failed (`[data-cy=send-partial]`), not a silent reload.
- [ ] EDIT: `normalize-phone` + `send-paperwork-sms:365-373` reject the 555 exchange with a translated reason; `sms/mod.ts:93-99` map the three Twilio codes to keys (both dicts); `InvoicesPage.tsx:1494-1513` compute per-channel outcomes and show the partial message; `:1686-1688`/`:1719-1721` reload only when nothing failed.

### 7.3 ⬜ NW-26 — "Ask a question" reaches the contractor by email + text (M) · slug `nw-26-inquiry-alert`

**Why.** `public-controller/mod.ts:574-604` only emits a bus event; the only sink is a bell notification that no UI renders in full (`DashboardPage.tsx:250-257` shows the title only); `contactBack` is dropped. The accept path shows the pattern: `:497 acceptedAlert.run(...)` → `send-accepted-alert/mod.ts:40-138` (email + SMS + comms log).

- [ ] RED Deno int: new `send-inquiry-alert/int.test.ts`: `run(quoteId, { question, contactBack, name })` → one email to `contractor.email` whose body contains the full question and `contactBack`, one SMS to `contractor.phoneNumber`, both logged via `LogPaperworkMessage`.
- [ ] RED jest integration (`public-controller/e2e.test.ts:208-225` is Deno; add a jest one): `POST /api/quotes/:id/inquiry` → the contractor's comms trail (`GET /messages` or the endpoint `ux-payment-receipt.int.test.ts` reads) has an entry containing the question.
- [ ] RED e2e (`public-doc-state.cy.ts` P-63 area): after asking, `cy.visit("/dashboard")` feed item shows the question body (`[data-cy=notif-body]`).
- [ ] EDIT: copy `send-accepted-alert/mod.ts` to `send-inquiry-alert/mod.ts` (subject key `inquiryAlert.email.subject` "{name} asked about {jobName}" / es; SMS key `inquiryAlert.sms.body`); register in `paperwork/mod-root.ts`; call it at `public-controller:602` (awaited, `.catch` logged like `:497`); render `n.body` in `DashboardPage.tsx:254`.

### 7.4 ◩ NW-28 — Signature block: named sentence in both languages, "↓" parity, PDF parity (S/M) · slug `nw-28-signature-parity`

**Why.** `quote-doc.tsx:250-269` forks on `lang === "en" && sig`; "you agree" appears only when no customer is bound (which NW-22 explains). The PDF (`render-quote-pdf/mod.ts:544-672`) has no "By signing below" sentence and titles the boxes "CONTRACTOR" / "CLIENT SIGNED" (`lang/*.json:2172-2173`).

- [ ] RED jest unit (`jest/unit/signature-block.test.ts`): `buildSignatureBlock({ …, lang:"es" })` returns the ES named sentence ("…{name} acepta…"), `By:`→`Por:`, `Date:`→`Fecha:`.
- [ ] RED e2e (`public-quote-signature.cy.ts`): ES view with a bound customer shows "acepta todo lo anterior" with the name; EN named instruction ends with "↓".
- [ ] EDIT `shared/quote-flow/signature-block.ts`: accept `lang`; `quote-doc.tsx:258-269` drop the `lang === "en"` forks; `render-quote-pdf/mod.ts:544-672` draw the sentence above the boxes and use `renderQuotePdf.sig.contractorSignature` "CONTRACTOR SIGNATURE" / `yourSignature` "YOUR SIGNATURE" (new keys, both dicts).

### 7.5 ◩ NW-39 — QuickBooks-style collapse control inside the sidebar (S) · slug `nw-39-sidebar-collapse-button`

**Why.** `DashSidebar.tsx:171-179` `toggle()` exists and persists; the only trigger is the topbar hamburger event (`:142-148`). `AsstThreads.tsx:145-177` already has the exact button to copy; `[data-cy=sidebar-collapse|expand]` are expected by `dashboard-assistant-access.cy.ts` and `TDD-QUOTE-FLOW.md:58` but never rendered.

- [ ] RED e2e: `dashboard-assistant-access.cy.ts` → `[data-cy=sidebar-collapse]` visible at 1280 px; click → rail collapsed and `[data-cy=sidebar-expand]` visible; reload keeps it collapsed.
- [ ] EDIT `DashSidebar.tsx:318`: above `sb__bottom` add the `AsstThreads.tsx:145-177` button (icons, `aria-label` keys `dashSidebar.collapse|expand` both dicts) calling `toggle()`; `data-cy` hydration-gated like `DashTopbar.tsx:87-91`.

### 7.6 ◩ NW-43f — The `/quotes?open=` panel gets a close/back control (S) · slug `nw-43f-quote-panel-close`

**Why.** `QuotesPage.tsx:164-201` has no close (`grep close` → 0 hits); `InvoicesPage.tsx:1145-1152` + `:415-427` is the model (X button, strips `?open=`).

- [ ] RED e2e (`quotes-copy-link.cy.ts` or a new `quotes-open-panel.cy.ts`): `cy.visit("/quotes?open=<id>")` → `[data-cy=quote-panel-close]` → panel gone and URL has no `open`.
- [ ] EDIT: copy the X button into `qopen__head`, `onClose` = `setOpenId(null)` + `history.replaceState` without `open`.

### 7.7 ◩ NW-55 — Expandable "Terms and Conditions", a Cancelation row, and a Send dialog with Keep/Cancel (M) · slug `nw-55-agreement-presentation`

(Invoice number: wait for 6.7.) **Why.** The clause `<ol>` is always open (`quote-doc.tsx:477-485`); cancelation is only clause 10 (`lang/*.json:833`) and lacks "work completed will be paid for";
the send channels are a caret menu with no title and no Keep/Cancel (`AsstChat.tsx:6374-6380`, keys `:316-319`).

- [ ] RED e2e (`public-quote-signature.cy.ts`): `details[data-cy=terms-details]` is collapsed on load, `summary` reads "Terms and Conditions", clicking opens 14 `li`; the term grid has a "Cancelation" row containing "7 days"; (`ux-send-moment.cy.ts`) clicking Send opens `[data-cy=send-dialog]` titled "How do you want to send to customer?" with three channel options and Keep / Cancel; Cancel closes without sending.
- [ ] RED jest unit (dictionary): `quoteDoc.clause.termination.body` ends with "Work completed before cancelation will be paid for." (es "El trabajo realizado antes de la cancelación se pagará."); same for the PDF twin.
- [ ] EDIT `quote-doc.tsx:477-485`: wrap the `<ol>` in `<details data-cy="terms-details"><summary>{t.terms}</summary>…</details>` (PDF stays flat); add a `cancellation` row to the term grid (`AsstChat.tsx:486-493` term rows + `TermGrid` labels, key `quoteDoc.termLabel.cancellation` "Cancelation" / "Cancelación", value "7 days' notice" / "Aviso de 7 días").
- [ ] EDIT `AsstChat.tsx:6374-6420`: promote the caret menu to a modal (`data-cy="send-dialog"`) with title key `asstChat.send.howTitle`, the existing three channel keys, `asstChat.send.keep` "Keep" / "Guardar" (saves the choice, sends), `asstChat.send.cancel` "Cancel" / "Cancelar".

### 7.8 ◩ NW-57 — Agreement header: "<Customer>'s <Job> Agreement", job name in the parties line, "Quick Summary" (M) · slug `nw-57-agreement-header` — after 6.6

**Why.** `heroTitle` is the raw job name (`quote-doc.tsx:239-242`); the parties line (`:361-378`) has no job name; "New job" leaks from `generateJobOptions.newJob`/`asstChat.newJob`; "Quick Summary" does not exist (`quoteDoc.plainEnglish` `:864`).

- [ ] RED e2e (`public-quote-signature.cy.ts`): `h1` reads "Godzilla's Concrete Patio Agreement" for customer Godzilla + job "Concrete Patio"; the parties line contains the job name; the section reads "Quick Summary". RED jest unit (`ux-page-copy.test.ts`): a new pure `agreementTitle({customer, job, lang})` → EN "Godzilla's Concrete Patio Agreement", ES "Acuerdo de Concrete Patio de Godzilla".
- [ ] EDIT: new helper in `shared/quote-flow/agreement-title.ts`; `quote-doc.tsx:240-242` use it when a customer is bound; `:363-367` interpolate the job name (new key `quoteDoc.betweenFor` "Between {contractor} and {customer} for {job}"); `quoteDoc.plainEnglish` → "Quick Summary" / "Resumen rápido"; mirror the title in `render-quote-pdf`. Replace the "New job" fallbacks with the job name when one exists.

### 7.9 ◩ NW-43b — Completion text AND email after send/sign, always both (M) · slug `nw-43b-both-channels`

**Why.** Channels depend on what the customer has on file (`AsstChat.tsx:698-702`). "Both always" means collecting the missing channel before send.
- [ ] RED e2e: a customer with email only → the send dialog (7.7) shows an inline "Add a phone to also text it" field; filling it saves to the customer and sends both.
- [ ] EDIT: in the send dialog, when the chosen channel needs a contact the customer lacks, show the input (`onEditCustomerField` `:2947` already persists) and then dispatch both.

### 7.10 ⬜ NW-06b — Business website on the From block (M) · slug `nw-06b-website-field`

- [ ] RED Deno int (`users/.../business-identity` store test): `upsert({ websiteUrl:"https://hans.work" })` round-trips. RED jest integration (`settings.int.test.ts`): `PUT` the identity with `websiteUrl` → `GET /quotes/:id/public` `contractor.websiteUrl` present. RED e2e (`settings-editable.cy.ts` + `ux-doc-preview.cy.ts`): Settings has `[data-cy=settings-website]`; the From card shows the URL.
- [ ] EDIT: `backend/src/users/dto/business-identity.ts` (`@IsOptional() @IsUrl() websiteUrl?`), the identity store, `PublicContractor` (`public-controller:878-903`) + `loadContractor` (`:906-934`), `SettingsPage.tsx` input, `doc-parts.tsx:183-248 PartyCard` row, `AsstChat.tsx:5571-5625` preview, `render-quote-pdf/mod.ts:161-166`, `send-paperwork-email/mod.ts:392-403`. Remove the dead `websiteUrl?` in `front-end/clients/profile.ts:20` or wire it.

### 7.11 ⬜ NW-52 — Soft delete + "recover the old account" on repeat-phone signup (L) · slug `nw-52-soft-delete`

**Why.** Every delete is a hard KV delete (`core/data/repository/mod.ts:75-79`, `quote-store:93-100`, `customer-store:88-95`, `user-store:168-175` — which also frees `user_by_phone`); `verify-otp/mod.ts:180-194` is pure find-or-create.
- [ ] RED Deno int: quote/customer `delete` → row has `deletedAt`, list endpoints exclude it, `get` by id still works for owners with `includeDeleted`; user delete keeps `user_by_phone`; `VerifyOtp` on a deleted user returns `{ recoverable: true }` without creating a new account; `POST /auth/recover` clears `deletedAt`; `POST /auth/start-fresh` re-keys the old user's phone (`user_by_phone_archived`) and creates a new one.
- [ ] RED jest integration + e2e (`/verify` shows "Recover my account / Start fresh" when the phone belonged to a deleted account).
- [ ] EDIT: `deletedAt?: string` on User/Quote/Customer DTOs; stores `update({deletedAt})` instead of `kv.delete`; list filters; `verify-otp` branch + two new routes; `DeleteQuoteButton.tsx:26-38` copy "moved to trash". Keep `wipe-account` as the only hard delete.

### 7.12 ◩⚠ NW-43c + NW-51a — Mobile: size it with a live run (S to size) · slug `mobile-responsive-audit`

- [ ] Run `cd cypress && npm run run:responsive` plus `e2e/landing-mobile-390.cy.ts`, `ux-landing-mobile.cy.ts`, `ux-dashboard-mobile-390.cy.ts` against the dev server; paste the summary into `TESTS-PROBLEMS.md:141` (the "39 specs" board is stale — 60 exist). Each red becomes its own S/M task with its own REQ.

### 7.13 ✅→S — Three cheap polish items from the "COMPLETED" half · slug `completed-half-polish`

- [ ] **NW-53f** price autofocus in help-me-price: `AsstChat.tsx` `autoFocus={!suggestPricing}` → `autoFocus`; RED e2e `quotes-help-me-price.cy.ts:71-73` asserts `cy.focused()` is the money input after picking a tier.
- [ ] **NW-53b** negative pin: `quotes-help-me-price.cy.ts` add `cy.get("textarea.composer__input").should("not.exist")` on the price and picker steps (passes on arrival — pin).
- [ ] **NW-48** SMS link on its own line: `lang/*.json:1588-1595` put `{url}` after a `\n`; RED unit `jest/unit/sms-template.test.ts` asserts the URL is on its own line.

---

## 8. Order of attack and what can run in parallel

| Lane | Tasks | Blocked by |
|---|---|---|
| **Day 1, first thing** | 0.A (deploy env check + loud boot) | — |
| **Lane A (copy/small, parallel boxes)** | 1.1, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 7.13 | — |
| **Lane B (assistant state)** | 1.2 → 1.3 → 1.4 → 1.5, 1.6, 1.7 | — (1.4 after 1.3) |
| **Lane C (pricing)** | Phase 2 | 0.A for a truthful "done" check |
| **Lane D (money)** | 3.1 → 3.2, 3.3, 3.4, 3.5 | 3.2/3.3 after 3.1 |
| **Lane E (invoice flow)** | 4.1 → 4.2 → 4.3 | 1.2 (draft status), 3.1 (paid/billed lines) |
| **Lane F (no-echo)** | 5.1 → 5.2 → 5.3 | 0.A |
| **After the client answers** | 6.1 – 6.9 | the answers |
| **Then** | 7.1 – 7.12 (any order; 7.8 after 6.6; 7.7 after 6.7; 7.9 after 7.7) | — |

Merge order matters only inside a lane. Every task ends with `/worktree-merge`; two lanes touching `AsstChat.tsx` (B, E, F) will
conflict at merge — merge B first, then rebase E and F (the merge tool reports the conflicting file; resolve by re-applying the smaller diff).

## 9. Coverage index — every triage id → the task that closes it

| NW | Task | NW | Task | NW | Task |
|---|---|---|---|---|---|
| NW-01 | 1.1 | NW-21 | 6.8 (needs screenshot) | NW-41 | ✅ none |
| NW-02 | 6.1 | NW-22 | 7.1 | NW-42 | ✅ (chat path → Phase 4) |
| NW-03 | 6.2 | NW-23 | 1.8 | NW-43a | ✅ none |
| NW-04 | 6.3 | NW-24 | 1.8 | NW-43b | 7.9 |
| NW-05 | 0.A + 5.1 + 5.2 + 5.3 | NW-25 | 7.2 | NW-43c | 7.12 |
| NW-06 | 1.6 (+7.10 website) | NW-26 | 7.3 | NW-43d | ✅ none |
| NW-07 | 6.3 | NW-27 | 3.1 | NW-43e | ✅ none |
| NW-08 | Phase 2 | NW-28 | 7.4 | NW-43f | 7.6 |
| NW-09 | Phase 2 | NW-29 | 3.3 | NW-43g | ✅ none |
| NW-10 | 1.2 | NW-30 | 1.10 | NW-44 | 6.5 |
| NW-11 | 0.A + 5.2 | NW-31 | 3.1 (b) · 3.4 (a) · 3.5 (c) | NW-45 | ✅ none |
| NW-12 | Phase 2 | NW-32 | 3.1 | NW-46 | 6.8 (needs docx) |
| NW-13 | 4.2 | NW-33 | 3.2 | NW-47 | 1.7 |
| NW-14 | 4.1 (+1.15 side-find) | NW-34 | 1.11 | NW-48 | 7.13 |
| NW-15 | 4.1 | NW-35 | 7.1 | NW-49 | ✅ (quality → Phase 2, 5) |
| NW-16 | 4.2 | NW-36 | 1.12 | NW-50 | ✅ none |
| NW-17 | 1.9 | NW-37 | 6.4 | NW-51a/b/c | 7.12 / ✅ / 6.9 |
| NW-18 | 4.2 | NW-38 | 6.2 | NW-52 | 7.11 |
| NW-19 | 1.4 + 1.5 | NW-39 | 7.5 | NW-53a/b/c/d/e/f/g | ✅ / 7.13 / 6.8 / ✅ / ✅ / 7.13 / 6.8 |
| NW-20 | 1.3 | NW-40 | ✅ none | NW-54 | 1.13 |
| | | | | NW-55 | 7.7 (+6.7) |
| | | | | NW-56 | 6.9 |
| | | | | NW-57 | 7.8 (+6.6, 6.8) |
| | | | | NW-58 | 6.9 |
| "COMPLETED"-half partials | 1.14 (governing law, warranty, Scope of Work) · 6.6 (plain-English section) · 6.2 (four boxes → three) · 1.5 (Toilet job editable) | | | | |

## 10. Message to send the client (copy, paste, send)

> Hi Hans — we've worked through all 58 items. Most are queued with no questions. Eight need your call before we touch them:
>
> 1. **Customer-doc footer contact.** Page 24 asks for `hello@paperworkmonster.com` / 866-767-8399. Page 61 (done) put *your* phone and email there ("Call 540-333-1334 or email hp@hans.work!"). Which one?
> 2. **"Just give me a quick quote."** It is identical to "I know my price, write it up." Page 35 says REMOVE THIS. Confirm: remove it (leaving three starter boxes)?
> 3. **Job-details step — one input.** Keep the chat box (talk or type, as on p66) and drop the "Write it myself" box on that step? "Professionalize that" stays available on the next screen per bullet. (That's our recommendation.) Or keep the box and hide the chat input?
> 4. **Pricing page.** Page 34 ($15 Starter, no Free) vs your Aug-31 recap that shipped (Free $0 / $99 / $199 / Projects custom). Which stands?
> 5. **Badge wording.** Ships as "Accepted"; you wrote "Approved". Change it?
> 6. **"01 The deal in plain English".** Page 57 says delete that sub-header; page 82 says rename it "Quick Summary". Which?
> 7. **Invoice numbers.** Do you want real sequential numbers (INV-0001…) or is the short id fine?
> 8. **Please send:** the "Yam" screenshot (or the sentence you typed), the new logo file, the "Quote & Agreement - Final.docx", the sentence "Contract for new job" screenshot, and what "Quote and Agreement change" (p60) refers to.
>
> Two scope notes: Spanish is one neutral Latin-American dictionary today (we recommend keeping it that way unless you want per-country wording); there is no separate "contract" feature to keep — the Quote + Agreement *is* the contract.
>
> Also: we are verifying today whether production is running with the AI switched on. If it is not, that alone explains the verbatim job descriptions and the low prices you saw.
