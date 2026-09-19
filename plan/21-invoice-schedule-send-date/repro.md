# Repro — Upcoming invoices cannot be given a send date; nobody nudges the Dragon

## Steps
1. `deno task serve`; log in; `/invoices` → New invoice: there is a due date but no "send on" date.
2. Create an invoice through the API with `scheduledFor` tomorrow and `status:"scheduled"`:
   `curl -s -b c.txt -X POST localhost:5280/api/invoices -H 'content-type: application/json' -d '{"customerId":"<id>","amount":50000,"dueDate":"2026-10-18","scheduledFor":"2026-09-19","status":"scheduled"}'`
   → it appears under "Upcoming" with "Scheduled to send <date>", but the card back has only "Send now" — the date cannot be changed.
3. Wait until the date: nothing pings you. `POST /api/cron/run-nudges` is never called by the app (call it by hand and it works).

## Confirm in code
```
sed -n 389p front-end/islands/InvoicesPage.tsx; sed -n 1606p front-end/islands/InvoicesPage.tsx   # scheduledFor read-only
sed -n 2338,2349p front-end/islands/InvoicesPage.tsx    # NewInvoiceModal: dueDate only
sed -n 44,51p backend/src/paperwork/entrypoints/cron-controller/mod.ts   # run-nudges exists
```

## Red tests
- `cd cypress` e2e for `[data-cy=invoice-schedule-date]` / `[data-cy=invoice-change-date]`.
- jest integration: create scheduled → `POST /cron/run-nudges` → `count >= 1` (likely green on arrival — pin it).
