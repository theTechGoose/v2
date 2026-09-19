# Repro — a customer with a sent invoice shows $0 owed on /clients

## Steps
1. `deno task serve`; log in; create a customer; on `/invoices` create an invoice for them ($500) and send it (status becomes `sent`).
2. Open `/clients` and read that customer's balance/status.
3. **Expected:** owes $500. **Actual:** $0 / not "owes" — the aggregation only counts `status === "pending"`.

## API check
```
curl -s -b c.txt localhost:5280/api/invoices | grep -o '"status":"[a-z]*"' | sort | uniq -c   # your invoice is "sent"
curl -s -b c.txt localhost:5280/api/clients | grep -o '"balanceCents":[0-9-]*'                 # 0
```

## Confirm in code
```
sed -n 106,118p backend/src/analytics/domain/coordinators/build-customer-cards/mod.ts   # only "pending" adds to balanceCents
sed -n 16,23p backend/src/paperwork/dto/invoice.ts                                       # the real status union
```

## Red test
`cd backend && deno test -A --unstable-kv src/analytics/domain/coordinators/build-customer-cards/int.test.ts` after adding the `sent → 50000` case.
