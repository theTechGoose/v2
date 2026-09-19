# Repro — "Just give me a quick quote" is the same flow as "I know my price"

## Steps
1. `deno task serve`; log in; `/assistant`: FOUR starter boxes render (p65's copy expects three).
2. Click "Just give me a quick quote." → note the greeting → type details → price → wizard.
3. New conversation → click "I know my price, write it up." → identical screens, only the greeting bubble differs.

## Confirm in code
```
sed -n 3225,3251p front-end/islands/AsstChat.tsx   # two functions, byte-identical except setFlowChip
sed -n 4871,4900p front-end/islands/AsstChat.tsx   # four chips
sed -n 79,85p cypress/e2e/quotes-help-me-price.cy.ts   # the decision is already parked as it.skip("[DECIDE p17]…")
sed -n 143,158p jest/unit/assistant-contracts.test.ts  # tests pin FOUR chips — they change with the decision
```
