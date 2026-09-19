# Repro — when an invoice becomes paid the customer never receives the invoice marked PAID

## Steps
1. `deno task serve` with Postmark/email configured (or read the comms trail instead); log in; send an invoice to a customer with an email.
2. Mark it paid the only way that exists today: as the customer open `/i/<id>` → "I sent it" (Zelle) → as the contractor "Okay, I got it".
   → an email goes out, but it is a **receipt** PDF ("RECEIPT", subject "Receipt for invoice #…"), not the invoice stamped Paid.
3. Mark another invoice paid through the API (`POST /api/payments` full amount, see folder 17) → **no email at all**.
4. Change status by `PUT /api/invoices/<id> {"status":"paid"}` → no email.

## Confirm in code
```
sed -n 107,131p backend/src/paperwork/domain/coordinators/confirm-payment/mod.ts       # receipt email, claim path only
sed -n 44,51p backend/src/paperwork/domain/coordinators/compute-invoice-balance/mod.ts  # flips to paid, emails nothing
sed -n 31p backend/src/paperwork/domain/coordinators/send-paperwork-email/mod.ts       # kinds: "quote" | "invoice" — no paid variant
sed -n 1351,1358p backend/src/paperwork/domain/coordinators/send-paperwork-email/mod.ts # money card says AMOUNT DUE
```

## Red tests
- Deno `send-paperwork-email` int test with `variant: "paid"` (input field does not exist yet).
- `cd jest && npx jest integration/ux-payment-receipt.int.test.ts` after adding the `POST /payments → paid email in the comms trail` case.
