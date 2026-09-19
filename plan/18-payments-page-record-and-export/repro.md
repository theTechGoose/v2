# Repro — "Record a payment" and "Export this month" on /payments go to the chat and stop

## Steps
1. `deno task serve`; log in; open `/payments`.
2. Click "Record a payment". **Actual:** you land on `/assistant` with "Record a payment I just received." pre-typed in the composer; nothing is recorded; the assistant has no payment intent.
3. Back on `/payments` click "Export this month". **Actual:** same — a pre-filled chat box; no CSV. Yet `GET /api/invoices/export.csv?year=2026` exists and streams a file.

## Confirm in code
```
sed -n 557,576p front-end/islands/PaymentsPage.tsx     # both are <a href="/assistant?seed=…">
sed -n 1298,1306p front-end/islands/AsstChat.tsx       # ?seed only setDraft()s
sed -n 312,320p backend/src/paperwork/entrypoints/invoice-controller/mod.ts   # export.csv: year only, no month
```

## Red tests
- `cd cypress && npx cypress run --spec e2e/payments-record.cy.ts` (new).
- `cd jest` integration case for `export.csv?year=&month=` (month filter does not exist yet).
