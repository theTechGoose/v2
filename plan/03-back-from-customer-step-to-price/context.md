# 1.3 🐛 NW-20 — Back from the customer step returns to the price step (S) · slug `nw-20-back-from-customer-step`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 1.3) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

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

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- Back button fails after you enter the price and go to the customer step. Hitting back takes you to the dashboard. [p31]
  - **NW-20 🐛 CONFIRMED for the chat/CTA entry; fixed for the price-panel entry by `4a1457a` but unpinned.** Effort S + S (spec).
  - Evidence: `customer` is wizard step **0** (`terms-wizard-spec/mod.ts:22-34`), so `assistant-back.ts:50` `(stepIdx ?? 0) > 0` is
    false and `:53` returns `"exit-dashboard"` (`AsstChat.tsx:1135-1137` → `/dashboard`; also `:1104-1110`) unless the snapshot stack
    is non-empty. Price panel path pushes before the hard navigation (`:2180-2184`, restored `:1145-1156`). Chat → action card →
    "Lock it in" → CTA → `transition-to-terms` pushes nothing (`:1746-1777`, `:3014-3031`, `:2599-2632`) → depth 0 + step 0 → dashboard.
  - Fix: the two `pushHistory()` calls from NW-19; optionally let the resolver treat "step 0 with a bound quote" as rewind-to-price.
  - Tests: **none** walk chip → details → price → customer → back. `jest/unit/assistant-back.test.ts:47-50` asserts the *current*
    exit behaviour ("empty stack at the wizard's first step → exit") and must be revised.

## Code at the cited lines (read from this tree while packaging)

### `shared/quote-flow/assistant-back.ts:50-53`

```
50:   if (v.previewOpen || (v.activeWizardStepIdx ?? 0) > 0) {
51:     return "rewind-wizard";
52:   }
53:   return "exit-dashboard";
```

### `front-end/islands/AsstChat.tsx:2184-2185`

```
2184:       pushHistory();
2185:       persistStackAs(convId);
```

### `front-end/islands/ChatHeaderLive.tsx:56-68`

```
56:       <a
57:         href="#"
58:         class="chat__head-btn"
59:         title={tFor(lang, "common.back")}
60:         aria-label={tFor(lang, "common.back")}
61:         style="text-decoration:none"
62:         onClick={(e) => {
63:           e.preventDefault();
64:           globalThis.dispatchEvent(new CustomEvent("pm:asst-back"));
65:         }}
66:       >
67:         <I d={ICN.back} size={15} />
68:       </a>
```

### `jest/unit/assistant-back.test.ts:47-50`

```
47:   it("empty stack at the wizard's first step → nothing to rewind → exit", () => {
48:     expect(resolveAssistantBack({ ...base(), activeWizardStepIdx: 0 }))
49:       .toBe("exit-dashboard");
50:   });
```
