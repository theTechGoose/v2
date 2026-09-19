# Repro — a 555 number reaches Twilio; an invoice "sent" with one failed channel reports success

## Steps
1. Twilio creds in `.env`; `deno task serve`; log in; create a customer with phone `+15125550100` (a 555 number) and a real email.
2. Send a quote "Text + Email" from the assistant → the divider honestly says "emailed, text failed" and shows the Twilio 21211 text.
3. Send an invoice to the same customer from `/invoices` ("Finish + send" or "Send nudge").
4. **Actual:** the page reloads as if everything went out; the SMS failure is dropped (`delivered` is an OR of the two channels; the copy only reads the email result).

## Confirm in code
```
sed -n 365,373p backend/src/paperwork/domain/coordinators/send-paperwork-sms/mod.ts   # shape-only check; 555 passes
sed -n 8,28p backend/src/users/domain/business/normalize-phone/mod.ts                  # same; its own test uses (512) 555-1234 as valid
sed -n 93,99p backend/src/users/domain/data/sms/mod.ts                                 # raw Twilio JSON as the reason
sed -n 1494,1513p front-end/islands/InvoicesPage.tsx                                   # delivered = email || text; only email reason reported
sed -n 1686,1688p front-end/islands/InvoicesPage.tsx                                   # reload on delivered
```

## Red tests
- `cd backend && deno test -A --unstable-kv src/users/domain/business/normalize-phone/test.ts` after adding the 555 case.
- `cd cypress && npx cypress run --spec e2e/invoice-send-honesty.cy.ts` after adding the partial-failure case.
