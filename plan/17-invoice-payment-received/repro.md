# Repro — no way to say "payment received" on an Out-for-payment invoice

## Steps
1. `deno task serve`; log in; `/invoices` → New invoice for a customer → send it (stage "Out for payment").
2. Open the card: the front CTA is "View invoice"; the card back offers Open / Mute; the detail panel offers Edit / Discount / Change order.
3. **Expected (p18, p28):** a "Payment received" action → pick how they paid. **Actual:** nothing. The only path to Paid is the *customer* clicking "I sent it" on `/i/<id>`, then you clicking "Okay, I got it".
4. Open `/payments`: empty — "once a customer pays an invoice it lands here automatically" never happens for cash/check/Zelle told to you in person.

## The backend already works — prove it
```
curl -s -b c.txt -X POST localhost:5280/api/payments -H 'content-type: application/json' \
  -d '{"invoiceId":"<id>","amount":50000,"method":"zelle","receivedAt":"2026-09-18T12:00:00Z"}'
curl -s -b c.txt localhost:5280/api/invoices/<id> | grep -o '"status":"[a-z]*"'    # "paid"
curl -s -b c.txt "localhost:5280/api/payments?invoiceId=<id>"                        # one row
```

## Confirm in code
```
sed -n 35,41p front-end/clients/payments.ts                     # read-only client, no create
sed -n 1155,1180p front-end/islands/InvoicesPage.tsx            # three buttons, none records a payment
sed -n 1726,1732p front-end/islands/InvoicesPage.tsx            # "out" falls through to open the public page
sed -n 59,62p backend/src/paperwork/domain/coordinators/confirm-payment/mod.ts   # confirm needs a customer claim
```

## Red test
`cd cypress && npx cypress run --spec e2e/invoice-detail-panel.cy.ts` after adding the `[data-cy=invoice-payment-received]` case. (Mind the P-31 "exactly one primary button" assertion at `:94`.)
