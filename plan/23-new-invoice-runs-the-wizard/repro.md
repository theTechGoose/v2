# Repro — the invoice flow skips every term question and has no preview

## Steps
1. `deno task serve`; log in; `/assistant` → "Job done, need to invoice." → type `Replaced the water heater` → send → price `900` → Continue.
2. **Expected (p9, p27):** the same questions as a quote — customer, completion date (instead of duration), payment terms, warranty — then the same preview to edit.
   **Actual:** customer → "Review your invoice before saving" (amount, name, one due-date input) → Save → "Invoice ready 🎉 … Send it now". No terms, no preview, and the invoice is already `status:"sent"` before you press Send.

## Confirm in code
```
sed -n 1861,1866p front-end/islands/AsstChat.tsx     # if (invoiceFlow) { openInvoiceCustomerStep(); return; }  — skips the wizard
sed -n 4684,4727p front-end/islands/AsstChat.tsx     # the three-field review card
sed -n 3431,3439p front-end/islands/AsstChat.tsx     # created status:"sent"
sed -n 19,21p backend/src/agents/domain/business/terms-wizard-spec/mod.ts   # one hard-coded spec; no completion_date step anywhere
grep -rn "completion_date\|completionDate" lang/en.json backend/src/agents || echo "no completion-date step or key exists"
```

## Red tests
- `cd backend && deno test -A --unstable-kv src/agents/domain/business/terms-wizard-spec/test.ts` (INVOICE_WIZARD_V1 case).
- `cd backend && deno test -A --unstable-kv src/agents/domain/coordinators/transition-to-terms/int.test.ts` (docKind case).
- `cd cypress && npx cypress run --spec e2e/ux-invoice-review.cy.ts` after the NW-13/18 rewrite.
