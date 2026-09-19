# Repro — header title is the bare job name; no job in the parties line; "The deal in plain English"

## Steps
1. `deno task serve`; create a quote for customer "Godzilla", job "Concrete Patio"; send; open `/q/<id>`.
2. **Actual:** `h1` = "Concrete Patio"; line below = "Between <Business> ("Contractor") and Godzilla ("Client") · effective <date>" — no job name; first section = "01 The deal in plain English".
   **Expected (p82):** "Godzilla's Concrete Patio Agreement"; the job between contractor and client; "Quick Summary".
3. Create a quote whose job name could not be derived → the title reads "New job".

## Confirm in code
```
sed -n 239,242p front-end/components/quote-doc.tsx    # heroTitle = raw jobName
sed -n 361,378p front-end/components/quote-doc.tsx    # parties line, no job
sed -n 864p lang/en.json; grep -rn "Quick Summary\|Resumen rápido" lang/ || echo "no such string"
grep -n '"generateJobOptions.newJob"\|"asstChat.newJob"' lang/en.json    # the "New job" fallbacks
```

## Red tests
- `cd jest && npx jest unit/ux-page-copy.test.ts` after adding the `agreementTitle()` case (module missing).
- `cd cypress && npx cypress run --spec e2e/public-quote-signature.cy.ts` after adding the title assertion.
