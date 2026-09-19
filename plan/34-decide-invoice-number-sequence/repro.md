# Repro — there is no real invoice number

## Steps
1. `deno task serve`; create two invoices; open each on `/invoices` and on `/i/<id>`.
2. The "number" is `INV-` + the first 6 characters of the random id (`/invoices`) or `#` + 8 characters (`/i/<id>` footer). Nothing increments.

## Confirm in code
```
sed -n 207p front-end/islands/InvoicesPage.tsx          # invoiceRef: `INV-${inv.id.slice(0,6)}`
sed -n 325p front-end/components/quote-doc.tsx           # quote doc-tag: #<id.slice(0,8)>
grep -rn "invoiceNumber\|nextInvoiceNo\|sequence" backend/src/paperwork | head -3 || echo "no stored counter"
```
Decision: p63 asks for an "Invoice number". A real sequence is a new field + atomic counter (M); the derived id is free.
