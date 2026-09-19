# Repro — invoice cards cannot be told apart

## Steps
1. `deno task serve`; log in; on `/invoices` click "New invoice" twice for the same customer with the same amount but different job names ("Deck Staining", "Gutter Cleaning").
2. Look at the two cards in the list.
3. **Expected:** the job name on each card. **Actual:** both read "<Customer> · INV-XXXXXX" + "$450" + the stage line — identical. The job name only appears after you open the card (detail headline).

## Confirm in code
```
sed -n 1923,1928p front-end/islands/InvoicesPage.tsx   # card row: initials, client · ref, amount, stage
sed -n 1110p front-end/islands/InvoicesPage.tsx; sed -n 1135,1137p front-end/islands/InvoicesPage.tsx   # detail already reads jobName
sed -n 98,104p front-end/clients/dashboard.ts           # Invoice type has no jobName field
curl -s -b c.txt localhost:5280/api/invoices | head -c 600   # the API row DOES carry jobName
```

## Red test
`cd cypress && npx cypress run --spec e2e/invoice-card-job-name.cy.ts` (new) → `[data-cy=invoice-card-job]` does not exist.
