# Repro — size the mobile work with a live run (nothing here is provable from code alone)

## Steps
1. `deno task serve` in one terminal. In another: `cd cypress && npm install` (first time only).
2. Run the four responsive specs and keep the output:
   ```
   npm run run:responsive
   npx cypress run --spec e2e/landing-mobile-390.cy.ts
   npx cypress run --spec e2e/ux-landing-mobile.cy.ts
   npx cypress run --spec e2e/ux-dashboard-mobile-390.cy.ts
   ```
3. Manually at 390 px (DevTools device toolbar): `/`, `/dashboard`, `/assistant` through a full quote, `/quotes`, `/invoices`, `/q/<id>`, `/i/<id>`. Screenshot anything clipped, overlapping, or unreachable.
4. Paste the spec totals into `TESTS-PROBLEMS.md:141` (its "39 specs, 200 passing" board is stale — 60 specs exist: `ls cypress/e2e | wc -l`).
5. Each red → its own task folder with a REQ id.
