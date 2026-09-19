# Repro — "Awaiting confirmation" has no nudge; "Send nudge" re-texts the whole invoice

## Steps
1. `deno task serve`; log in; send an invoice; as the customer open `/i/<id>` and click "I sent it" → stage "Awaiting confirmation".
2. Flip the card: the only buttons are "Okay, I got it" (which marks it PAID), "Didn't get it", "Text client". No nudge.
3. Take another invoice past its due date (create with `dueDate` yesterday, send) → stage "Overdue" → front CTA "Send nudge".
   Open the network tab and click it: it POSTs `/api/invoices/<id>/text` — the full invoice SMS again, not the reminder cadence.

## Confirm in code
```
sed -n 53,64p backend/src/paperwork/entrypoints/cron-controller/mod.ts     # POST /cron/invoice-reminder "backs the Send nudge button"
grep -rn "cron/" front-end/ --include=*.ts --include=*.tsx | grep -v ui-breakdown || echo "zero front-end callers of /cron/*"
sed -n 1726,1732p front-end/islands/InvoicesPage.tsx                        # overdue → doSendText
sed -n 2288,2298p front-end/islands/InvoicesPage.tsx                        # claimed card back: reject only
```

## Red tests
- `cd cypress && npx cypress run --spec e2e/invoice-detail-panel.cy.ts` after adding `[data-cy=invoice-nudge]` + the `cy.intercept` on `/api/cron/invoice-reminder`.
- jest integration `POST /cron/invoice-reminder { invoiceId, day: 3 }` on a claimed invoice.
