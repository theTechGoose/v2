# Repro — the "Who's on your books" chart charts a field nobody writes

## Steps
1. `deno task serve`; log in; create three customers from `/clients` and one from the assistant wizard.
2. Look at the "Who's on your books" section on `/clients`.
3. **Actual:** Property mgmt 0 / Homeowners 0 / Small biz 0 / HOAs 0 / Unsorted 4. There is no place in the app to set a segment.

## Confirm in code
```
grep -rn "segment" backend/src/crm/dto/customer.ts                       # declared
grep -rn "segment" front-end/islands/ClientsPage.tsx front-end/islands/AsstChat.tsx backend/src/agents/domain/coordinators/handle-wizard-answer/mod.ts | grep -v segments   # no write path
sed -n 251,289p front-end/components/ClientsSections.tsx                 # the chart
sed -n 78,104p backend/src/analytics/entrypoints/clients-controller/mod.ts   # everyone lands in "unsorted"
```

## Red test
`cd cypress && npx cypress run --spec e2e/clients-page-quality.cy.ts` after adding `cy.get(".csegment2").should("not.exist")`.
