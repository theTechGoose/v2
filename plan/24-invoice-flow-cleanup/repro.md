# Repro — what is left over after folder 23 lands

This folder is cleanup, not a bug. Run these AFTER 4.2 is merged to see what still references the old standalone flow:

```
grep -n "invoiceCustomerOpen\|invoiceReview\|invoiceResult\|createInvoiceFromFlow\|saveInvoiceFromReview\|openInvoiceCustomerStep" front-end/islands/AsstChat.tsx
grep -rn "asstChat.invoiceFlow" front-end shared lang | grep -v ui-breakdown
grep -n "invoiceResultOpen" shared/quote-flow/assistant-back.ts jest/unit/assistant-back.test.ts
```
Every hit is a line to delete (or a key to remove from both dictionaries). The build must stay green: `cd front-end && deno task build`.
