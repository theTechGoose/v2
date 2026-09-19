# Repro — two inputs on the job-details step

## Steps
1. `deno task serve`; log in; `/assistant` → "I know my price, write it up." (same for "I know the job, help me price it.").
2. On the job-details step you see BOTH: the chat composer at the bottom with placeholder "Ex: Customer wants a 10'x10' slab…" (flashing), and a "✎ Write it myself" pill that opens a one-item-per-line editor with "Professionalize that".
3. Type in either — both work. That is the p3/p6 complaint: "We don't need both."

## Confirm in code
```
sed -n 7262,7266p front-end/islands/AsstChat.tsx   # composerHidden deliberately excludes awaitingJobDetails (and writeMyselfOpen)
sed -n 7282,7286p front-end/islands/AsstChat.tsx   # composer--flash highlights the composer on exactly this step
sed -n 4402,4432p front-end/islands/AsstChat.tsx   # the pill + editor
sed -n 25,27p cypress/e2e/quotes-professionalize.cy.ts; sed -n 66,69p cypress/e2e/ux-help-me-price.cy.ts   # one green spec pins each affordance
```
