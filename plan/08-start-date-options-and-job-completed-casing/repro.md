# Repro — "Job Completed" in the start-date options; "Next Month" / "Job Completed" casing

## Steps
1. `deno task serve`; log in; `/assistant` → "I know my price, write it up." → details → price → Continue → customer step (create one) → next step "When does the job start?".
2. **Expected:** Right away / Next week / Next month / Pick a date. **Actual:** five options: … / Next Month (capital M) / Job Completed / Pick a date.
3. Pick "Job Completed" on any step, finish, open `/q/<id>` and the PDF → the value prints "Job Completed" (capital C).

## Confirm in code
```
sed -n 36,51p backend/src/agents/domain/business/terms-wizard-spec/mod.ts   # job_completed inside start_date
sed -n 890p lang/en.json; sed -n 928,930p lang/en.json; sed -n 941p lang/en.json; sed -n 2185p lang/en.json
sed -n 18,28p front-end/lib/term-i18n.ts   # exact-string map: "Job Completed" present, "Job completed" absent
```

## Red tests
- `cd backend && deno test -A --unstable-kv src/agents/domain/business/terms-wizard-spec/test.ts` (new).
- `cd jest && npx jest unit/i18n-dictionary-consistency.test.ts` after adding the casing assertions.
- `cd cypress && npx cypress run --spec e2e/quotes-wizard-navigation.cy.ts` after adding the option-list assertion.
