# Repro — Job Details is read-only on the review card

## Steps
1. `deno task serve`; log in; `/assistant` → "I know my price, write it up." → details → price → walk the wizard
   (customer: "+ New customer", name + phone; then pick the first option on each remaining step).
2. The Quote + Agreement review card opens.
3. Click the customer name → it is `contentEditable`. Click the total → editable. Hover the term rows → pencils.
4. Click the Job Details bullets.
5. **Expected:** an edit control (pencil) that reopens the job picker. **Actual:** plain text, nothing happens.

## Confirm in code
```
sed -n 5853,5879p front-end/islands/AsstChat.tsx   # plain <ul>/<p>, no control
sed -n 5665,5690p front-end/islands/AsstChat.tsx   # the editable pattern used by every other field
```

## Red test
`cd cypress && npx cypress run --spec e2e/ux-doc-preview.cy.ts` with the `[data-cy=review-job-details-edit]` case.
