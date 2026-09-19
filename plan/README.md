# plan/ — the New Working Issues plan, one folder per task

Each folder = one top-level task from `../new-working-issues-plan.md`. Inside: `context.md` (the task verbatim, its sub-bullets, the triage items it closes, and the real code at every cited line) and `repro.md` (how to see the problem yourself before you touch anything). Work the folders in numeric order unless §8 below says a lane can run in parallel.

## Folders

- `00-prod-llm-client-loud-boot/` — 0.A ⚠ Is prod on the stub LLM? (S, but it decides the size of Phase 5)
- `01-landing-lang-toggle-spanish-first/` — 1.1 🐛 NW-01 — Landing language toggle: Spanish button first (S) · slug `nw-01-lang-toggle-order`
- `02-quote-born-draft-not-sent/` — 1.2 🐛 NW-10 — A quote is born `draft`, not `sent` (S) · slug `nw-10-quote-born-draft`
- `03-back-from-customer-step-to-price/` — 1.3 🐛 NW-20 — Back from the customer step returns to the price step (S) · slug `nw-20-back-from-customer-step`
- `04-back-on-chat-lock-terms-path/` — 1.4 ◩ NW-19 — Back works on the chat → "Lock it in" → terms path (M) · slug `nw-19-back-chat-lock-path`
- `05-review-card-job-details-editable/` — 1.5 ◩ NW-19b — Job Details is editable on the review card (M) · slug `nw-19-job-details-pencil`
- `06-assistant-route-from-prop/` — 1.6 🐛 NW-06 — `/assistant` passes the `from` prop (S) · slug `nw-06-from-prop-and-website`
- `07-starter-chip-not-captured-as-name/` — 1.7 🐛 NW-47 — The starter chip text is never captured as the contractor's name (S) · slug `nw-47-first-turn-name-guard`
- `08-start-date-options-and-job-completed-casing/` — 1.8 ◩ NW-23 + 🐛 NW-24 — Start-date options and "Job completed" casing (S) · slug `nw-23-24-start-date-options-casing`
- `09-write-it-myself-period-spacing/` — 1.9 🐛 NW-17 — "Write it myself." gets its period and breathing room (S) · slug `nw-17-write-it-myself-period`
- `10-invoice-cards-show-job-name/` — 1.10 🐛 NW-30 — Invoice cards show the job name (S) · slug `nw-30-invoice-card-job-name`
- `11-phone-input-mask-as-you-type/` — 1.11 🐛 NW-34 — Phone numbers format as `(555) 123-4567` while typing (S) · slug `nw-34-phone-input-mask`
- `12-remove-customers-segments-chart/` — 1.12 🐛 NW-36 — Remove the "Who's on your books" chart (S) · slug `nw-36-remove-segments-chart`
- `13-terms-and-conditions-heading/` — 1.13 ◩ NW-54 — "Terms and Conditions" heading on web + PDF (S) · slug `nw-54-terms-and-conditions-heading`
- `14-completed-half-copy-fixes/` — 1.14 ◩ Copy fixes from the "COMPLETED" half: governing-law tail, warranty labels, "Scope of Work" (S) · slug `completed-half-copy-fixes`
- `15-customer-balance-counts-unpaid-statuses/` — 1.15 🐛 NW-14 side-find — Customer balance counts every unpaid invoice status (S) · slug `customer-balance-unpaid-statuses`
- `16-pricing-tiers-zip-materials-basis/` — Phase 2 — One pricing rewrite closes NW-08 + NW-09 + NW-12 (M) · slug `nw-08-09-12-pricing-tiers`
- `17-invoice-payment-received/` — 3.1 ⬜ NW-27 + NW-32 — "Payment received" on Out-for-payment / Overdue / Awaiting (M) · slug `nw-27-payment-received`
- `18-payments-page-record-and-export/` — 3.2 ◩ NW-33 — "Record a payment" and "Export" on /payments do real things (S) · slug `nw-33-payments-hero-actions`
- `19-paid-invoice-emailed-to-customer/` — 3.3 ◩ NW-29 — When an invoice becomes paid, the customer gets the invoice marked PAID (M) · slug `nw-29-paid-invoice-email`
- `20-invoice-nudge-uses-reminder-cadence/` — 3.4 ◩ NW-31a — "Awaiting confirmation" gets a real nudge; "Send nudge" uses the reminder cadence (S) · slug `nw-31a-invoice-nudge`
- `21-invoice-schedule-send-date/` — 3.5 ◩ NW-31c — Upcoming invoices: pick a send date; nudge the Dragon when it is due (M) · slug `nw-31c-schedule-send`
- `22-invoice-from-accepted-quote/` — 4.1 ⬜ NW-14 + NW-15 — Picking an accepted job skips to a seeded review (M) · slug `nw-14-15-invoice-from-accepted-quote`
- `23-new-invoice-runs-the-wizard/` — 4.2 🐛 NW-13 + NW-18 + NW-16 — A brand-new invoice runs the wizard (customer → completion date → payment → warranty) and lands on the shared preview (L) · slug `nw-13-18-invoice-wizard`
- `24-invoice-flow-cleanup/` — 4.3 Cleanup after 4.2 (S) · same worktree as 4.2 or slug `nw-13-cleanup`
- `25-scope-bullets-from-raw-no-echo/` — 5.1 Honest scope bullets from raw text (pure helper, both fallbacks) (M) · slug `nw-05-scope-from-raw`
- `26-job-options-spinner-before-heuristic/` — 5.2 Front-end: spinner first, heuristic only on failure, honest degraded state (S) · slug `nw-11-spinner-before-options`
- `27-prompts-no-verbatim-mirroring/` — 5.3 Prompts stop licensing the echo (S) · slug `nw-05-prompt-no-verbatim`
- `28-decide-footer-contact/` — 6.1 ❓ NW-02 — Whose contact goes in the customer-doc footer? (S once decided) · slug `nw-02-footer-contact`
- `29-decide-remove-quick-quote-chip/` — 6.2 ❓ NW-03 + NW-38 — Remove "Just give me a quick quote"? (S) · slug `nw-38-remove-quick-quote-chip`
- `30-decide-one-job-details-input/` — 6.3 ❓ NW-04 + NW-07 — On the job-details step, which input survives: the chat composer or the "Write it myself" box? (M) · slug `nw-04-one-details-input`
- `31-decide-pricing-page/` — 6.4 ❓ NW-37 — Pricing page: $15 Starter / no Free (p34) or Hans's 2026-08-31 recap (Free $0 / $99 / $199 / custom) that shipped?
- `32-decide-approved-badge-label/` — 6.5 ❓ NW-44 — Badge says "Accepted"; client wrote "Approved". (S) · slug `nw-44-approved-label`
- `33-decide-plain-english-section/` — 6.6 ❓ p57 vs p82 — "01 The deal in plain English": delete it (p57) or rename it "Quick Summary" (p82, NW-57)?
- `34-decide-invoice-number-sequence/` — 6.7 ❓ NW-55 — Do you want a real invoice number sequence (INV-0001…) or is the derived `#<8 chars of id>` fine?
- `35-decide-missing-artefacts/` — 6.8 ❓ Need the artefact before anything can be done
- `36-decide-scope-calls/` — 6.9 ❓ Scope calls (not bugs)
- `37-customer-create-from-dropdown/` — 7.1 ◩ NW-22 + NW-35 — Create a customer straight from the assistant dropdown; never a silently disabled Next (S–M) · slug `nw-22-35-customer-create-from-dropdown`
- `38-sms-555-rejection-and-channel-honesty/` — 7.2 🐛 NW-25 — Reject 555 numbers before Twilio; report each channel honestly (M) · slug `nw-25-sms-honesty`
- `39-inquiry-alert-to-contractor/` — 7.3 ⬜ NW-26 — "Ask a question" reaches the contractor by email + text (M) · slug `nw-26-inquiry-alert`
- `40-signature-block-parity/` — 7.4 ◩ NW-28 — Signature block: named sentence in both languages, "↓" parity, PDF parity (S/M) · slug `nw-28-signature-parity`
- `41-sidebar-collapse-button/` — 7.5 ◩ NW-39 — QuickBooks-style collapse control inside the sidebar (S) · slug `nw-39-sidebar-collapse-button`
- `42-quote-panel-close-control/` — 7.6 ◩ NW-43f — The `/quotes?open=` panel gets a close/back control (S) · slug `nw-43f-quote-panel-close`
- `43-agreement-tc-cancelation-send-dialog/` — 7.7 ◩ NW-55 — Expandable "Terms and Conditions", a Cancelation row, and a Send dialog with Keep/Cancel (M) · slug `nw-55-agreement-presentation`
- `44-agreement-header-title-quick-summary/` — 7.8 ◩ NW-57 — Agreement header: "<Customer>'s <Job> Agreement", job name in the parties line, "Quick Summary" (M) · slug `nw-57-agreement-header` — after 6.6
- `45-completion-alerts-both-channels/` — 7.9 ◩ NW-43b — Completion text AND email after send/sign, always both (M) · slug `nw-43b-both-channels`
- `46-business-website-field/` — 7.10 ⬜ NW-06b — Business website on the From block (M) · slug `nw-06b-website-field`
- `47-soft-delete-and-account-recovery/` — 7.11 ⬜ NW-52 — Soft delete + "recover the old account" on repeat-phone signup (L) · slug `nw-52-soft-delete`
- `48-mobile-responsive-audit/` — 7.12 ◩⚠ NW-43c + NW-51a — Mobile: size it with a live run (S to size) · slug `mobile-responsive-audit`
- `49-completed-half-polish/` — 7.13 ✅→S — Three cheap polish items from the "COMPLETED" half · slug `completed-half-polish`

## 0. Setup — read once, then follow for every task



## 0.1 Tools you need on the machine

- [ ] `deno` (the app), `node`+`npm` (jest + cypress). Check: `deno --version && node --version`.
- [ ] Jest deps are installed already (`jest/node_modules` exists). Cypress deps are **not**: run `cd cypress && npm install` once.
- [ ] A `.env` at the repo root with `OPENAI_API_KEY=…` (needed for every LLM-backed integration/e2e test). Do not commit it.

## 0.2 The four test layers and how to run each

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

## 0.3 The loop — do this for EVERY task below, in this order

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

## 0.4 Corrections to the triage's paths (the code moved; the triage's line numbers are otherwise exact)

| Triage says | Actual path |
|---|---|
| `backend/src/paperwork/domain/business/lock-quote/` | `backend/src/agents/domain/coordinators/lock-quote/mod.ts` |
| `backend/src/agents/domain/business/handle-chat-message/` | `backend/src/agents/domain/coordinators/handle-chat-message/mod.ts` |
| `…/llm/implementations/stub/mod.ts` under `data/` | `backend/src/agents/domain/business/llm/implementations/stub/mod.ts` |
| `confirmSendFromReview` (`AsstChat.tsx:2816`) | function is `confirmSendQuote` (`AsstChat.tsx:2788-2816`) |

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
