# 1.4 ◩ NW-19 — Back works on the chat → "Lock it in" → terms path (M) · slug `nw-19-back-chat-lock-path`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 1.4) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

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

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- Fix the Go Back button for all of the tasks. Job Details is not editable on the review card, so they need a back button. [p13]
  - **NW-19 ◩ one universal back exists on every screen; three forward moves push no snapshot; Job Details is definitively read-only on the review card.** Effort S + M.
  - Evidence: single header back `front-end/islands/ChatHeaderLive.tsx:56-68` (dispatches `pm:asst-back`; in the shell
    `routes/assistant/[threadId].tsx:138`, `index.tsx:93`); per-step backs removed by design (`AsstChat.tsx:6935-6939`, `:7856-7859`,
    `:4737-4738`, `:4751-4753`); resolver `shared/quote-flow/assistant-back.ts:46-54` (invoiceResult → exit; viewStack → pop;
    preview or stepIdx>0 → rewind; else exit-dashboard). Commit `4a1457a` added the price→wizard snapshot (`:2182-2184`
    `pushHistory(); persistStackAs(convId)`). **Missing `pushHistory()`**: `sendText→submitTurn` `:1746-1777`, `lockActionCard`
    `:3014-3031`, `submitContinueCta` `toPhase==="terms"` `:2599-2632`. Job Details on the review card `:5853-5878` is plain
    `<ul>/<p>`; every other field is `contentEditable` or has a pencil (`:5666-5667`, `:5681-5686`, `:5704-5709`, `:6176-6177`, `:6137`).
  - Fix: `pushHistory()` at the top of those three; a `quote-review__term-edit`-style pencil on Job Details (`:5857-5878`) that
    reopens the picker.
  - Tests: `cypress/e2e/ux-assistant-single-back.cy.ts:36-99`, `assistant-history.cy.ts:38-98`, `quotes-wizard-navigation.cy.ts:36`,
    `jest/unit/assistant-back.test.ts`, `wizard-nav.test.ts`. None for Job Details editability.

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/AsstChat.tsx:1760-1766`

```
1760:     }
1761:     setDraft("");
1762:     autosize();
1763:     await submitTurn(
1764:       { role: "user", kind: "text", content: trimmed },
1765:       () =>
1766:         assistantClient.chat({
```

### `front-end/islands/AsstChat.tsx:3010-3016`

```
3010:    * when asked to lock). Idempotent server-side, so a double-click
3011:    * just re-renders the locked state.
3012:    */
3013:   async function lockActionCard(message: Message, payload: ActionCardPayload) {
3014:     if (sending || !convoId || !payload.quoteId) return;
3015:     setError(undefined);
3016:     setSending(true);
```

### `front-end/islands/AsstChat.tsx:2606-2612`

```
2606:       toPhase?: string;
2607:       quoteId?: string;
2608:     };
2609:     if (payload.toPhase === "terms") {
2610:       if (!convoId) return;
2611:       // Stash the kind picked on the CTA so CustomerStepPanel can skip its
2612:       // own kind picker. Cleared when the panel consumes it.
```

### `front-end/islands/AsstChat.tsx:1108-1110`

```
1108:     if (snap.wizardStepIdx === null && noPanel && messages.length > 0) {
1109:       globalThis.location.href = "/dashboard";
1110:     }
```

### `backend/src/agents/domain/coordinators/rewind-wizard/mod.ts:76-79`

```
76:     const target = Math.max(
77:       0,
78:       Math.min(input.toStepIdx ?? state.activeStepIdx - 1, state.activeStepIdx),
79:     );
```
