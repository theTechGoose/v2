# Repro — picking an accepted job still asks "What's the price?" and forgets the customer

## Steps
1. `deno task serve`; log in; create a quote, send it, and accept it as the customer on `/q/<id>` (sign).
2. `/assistant` → "Job done, need to invoice." → the accepted job appears as a chip ("Invoice for <job> — <customer> — $…").
3. Click the chip.
4. **Expected (p10–11):** a screen that already knows the customer and shows what they paid / owe / the terms.
   **Actual:** "What's the price?" with the amount prefilled; then the customer step asks you to pick a customer again; the saved invoice has no `quoteId`, so `/i/<id>` shows the amount-only layout without terms or the signed-quote link.

## Prove the link is dropped
```
sed -n 3307,3311p front-end/islands/AsstChat.tsx     # chip .map keeps jobName/customerName/totalCents only — no id
sed -n 4382,4392p front-end/islands/AsstChat.tsx     # click → setPriceCaptureOpen(true)
sed -n 3431,3439p front-end/islands/AsstChat.tsx     # POST /invoices body: no quoteId, no lineItems
sed -n 213,224p backend/src/paperwork/entrypoints/invoice-controller/mod.ts   # the derive-from-quote path that never fires
curl -s -b c.txt localhost:5280/api/invoices | grep -o '"quoteId"' | wc -l         # 0 for chat-made invoices
```

## Red test
`cd cypress && npx cypress run --spec e2e/ux-invoice-review.cy.ts` after adding the NW-14/15 describe (`cy.contains("What's the price?").should("not.exist")`).
