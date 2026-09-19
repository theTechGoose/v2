# 1.8 ◩ NW-23 + 🐛 NW-24 — Start-date options and "Job completed" casing (S) · slug `nw-23-24-start-date-options-casing`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 1.8) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

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

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- "When does the job start?" has a "Job Completed" option. Remove it and put "Pick a date" in its place. Change "Next Month" to "Next month". [p22]
  - **NW-23 ◩ "Pick a date" already exists (last option, real calendar); the ask reduces to one delete + one lowercase.** Effort S.
  - Evidence: `terms-wizard-spec/mod.ts:36-50` `start_date` options: `asap` "Right away" (`lang/en.json:926`), `next_week`
    "Next week" (`:931`), `next_month` **"Next Month"** (`:930`; es "El próximo mes"), `job_completed` "Job Completed" (`:928`,
    hand-added at `:43-47` "Roadmap p.4/5: paperwork written AFTER the work happened", paired with `due_now` `:71-73`), `custom`
    "Pick a date" (`:927`, `isCustom` → `CustomDatePickerForm` `AsstChat.tsx:6874-6883`, `:8184+`). The `wraps` step has its own
    separate `job_completed` (`:60-63`) — not a shared list.
  - Fix: delete `:43-47`; `lang/en.json:930` → "Next month" (lookup tables already carry both spellings: `front-end/lib/term-i18n.ts:24-25`,
    `render-quote-pdf/mod.ts:863-864`, `render-invoice-pdf/mod.ts:707-708`). Tests: none pin labels; `i18n-dictionary-consistency` enforces key parity.

- Change "Job Completed" to "Job completed" (lowercase c). [p23]
  - **NW-24 🐛 copy change with a persistence trap.** Effort S.
  - Evidence: `lang/en.json:890` `quoteDoc.termValue.jobCompleted`, `:928` `termsWizard.startDate.jobCompleted`, `:941`
    `termsWizard.wraps.jobCompleted`, `:2185` `renderQuotePdf.termValue.jobCompleted`. ES already "Trabajo terminado". Term values
    are **persisted in English and re-localized by exact string match**: `front-end/lib/term-i18n.ts:26`, `render-quote-pdf/mod.ts:865`,
    `render-invoice-pdf/mod.ts:709` key on `"Job Completed"`.
  - Fix: lowercase the four values and add a `"Job completed"` entry beside the old key in all three maps (pattern: "Next Month"/"Next month").

## Code at the cited lines (read from this tree while packaging)

### `backend/src/agents/domain/business/terms-wizard-spec/mod.ts:44-48`

```
44:         {
45:           // Roadmap p.4/5: paperwork written AFTER the work happened.
46:           id: "job_completed",
47:           label: "termsWizard.startDate.jobCompleted",
48:         },
```

### `backend/src/agents/domain/business/terms-wizard-spec/mod.ts:46-52`

```
46:           id: "job_completed",
47:           label: "termsWizard.startDate.jobCompleted",
48:         },
49:         { id: "custom", label: "termsWizard.startDate.custom", isCustom: true },
50:       ],
51:     },
52:     {
```

### `front-end/lib/term-i18n.ts:18-28`

```
18:   const exact: Record<string, string> = {
19:     "Payment upon completion": "quoteDoc.termValue.paymentUponCompletion",
20:     "Deposit + balance": "quoteDoc.termValue.depositBalance",
21:     "No warranty": "quoteDoc.termValue.noWarranty",
22:     "Right away": "quoteDoc.termValue.rightAway",
23:     "Next week": "quoteDoc.termValue.nextWeek",
24:     "Next Month": "quoteDoc.termValue.nextMonth",
25:     "Next month": "quoteDoc.termValue.nextMonth",
26:     "Job Completed": "quoteDoc.termValue.jobCompleted",
27:     "Due Now": "quoteDoc.termValue.dueNow",
28:   };
```

### `backend/src/paperwork/domain/coordinators/render-quote-pdf/mod.ts:857-867`

```
857:   const exactKey: Record<string, string> = {
858:     "Payment upon completion": "renderQuotePdf.termValue.paymentUponCompletion",
859:     "Deposit + balance": "renderQuotePdf.termValue.depositPlusBalance",
860:     "No warranty": "renderQuotePdf.termValue.noWarranty",
861:     "Right away": "renderQuotePdf.termValue.rightAway",
862:     "Next week": "renderQuotePdf.termValue.nextWeek",
863:     "Next Month": "renderQuotePdf.termValue.nextMonth",
864:     "Next month": "renderQuotePdf.termValue.nextMonth",
865:     "Job Completed": "renderQuotePdf.termValue.jobCompleted",
866:     "Due Now": "renderQuotePdf.termValue.dueNow",
867:   };
```

### `backend/src/paperwork/domain/coordinators/render-invoice-pdf/mod.ts:701-711`

```
701:   const exactKey: Record<string, string> = {
702:     "Payment upon completion": "renderQuotePdf.termValue.paymentUponCompletion",
703:     "Deposit + balance": "renderQuotePdf.termValue.depositPlusBalance",
704:     "No warranty": "renderQuotePdf.termValue.noWarranty",
705:     "Right away": "renderQuotePdf.termValue.rightAway",
706:     "Next week": "renderQuotePdf.termValue.nextWeek",
707:     "Next Month": "renderQuotePdf.termValue.nextMonth",
708:     "Next month": "renderQuotePdf.termValue.nextMonth",
709:     "Job Completed": "renderQuotePdf.termValue.jobCompleted",
710:     "Due Now": "renderQuotePdf.termValue.dueNow",
711:   };
```

### `backend/src/agents/domain/business/terms-wizard-spec/mod.ts:61-64`

```
61:         {
62:           id: "job_completed",
63:           label: "termsWizard.wraps.jobCompleted",
64:         },
```

### `front-end/lib/term-i18n.ts:23-29`

```
23:     "Next week": "quoteDoc.termValue.nextWeek",
24:     "Next Month": "quoteDoc.termValue.nextMonth",
25:     "Next month": "quoteDoc.termValue.nextMonth",
26:     "Job Completed": "quoteDoc.termValue.jobCompleted",
27:     "Due Now": "quoteDoc.termValue.dueNow",
28:   };
29:   if (exact[trimmed]) return tFor(lang, exact[trimmed]);
```

### `backend/src/paperwork/domain/coordinators/render-quote-pdf/mod.ts:862-868`

```
862:     "Next week": "renderQuotePdf.termValue.nextWeek",
863:     "Next Month": "renderQuotePdf.termValue.nextMonth",
864:     "Next month": "renderQuotePdf.termValue.nextMonth",
865:     "Job Completed": "renderQuotePdf.termValue.jobCompleted",
866:     "Due Now": "renderQuotePdf.termValue.dueNow",
867:   };
868:   if (exactKey[trimmed]) return t(lang, exactKey[trimmed]);
```

### `backend/src/paperwork/domain/coordinators/render-invoice-pdf/mod.ts:706-712`

```
706:     "Next week": "renderQuotePdf.termValue.nextWeek",
707:     "Next Month": "renderQuotePdf.termValue.nextMonth",
708:     "Next month": "renderQuotePdf.termValue.nextMonth",
709:     "Job Completed": "renderQuotePdf.termValue.jobCompleted",
710:     "Due Now": "renderQuotePdf.termValue.dueNow",
711:   };
712:   if (exactKey[trimmed]) return t(lang, exactKey[trimmed]);
```
