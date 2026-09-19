# Repro — "Incredible Hulk" did not save; the dropdown input is not a create

## Steps
1. `deno task serve`; log in; `/assistant` → "I know my price, write it up." → details → price → Continue → customer step.
2. Click "Choose an existing customer" and type `Incredible Hulk` in the box inside the dropdown.
3. **Actual:** "No matches" and nothing else — that box is a search filter. The real create is the separate "+ New customer" button below.
4. Click "+ New customer", type name "Incredible Hulk", business "Green Machine", leave phone and email empty.
5. **Actual:** Next is disabled with no message (the hint only appears once you start typing a contact). On `/clients` the same name-only create is allowed.
6. Type your OWN phone number → the server rejects with a raw English error string.

## Confirm in code
```
sed -n 7957,7981p front-end/islands/AsstChat.tsx   # search box + "no matches" dead end
sed -n 8012,8019p front-end/islands/AsstChat.tsx   # the real create button
sed -n 7760,7776p front-end/islands/AsstChat.tsx   # submitDisabled = … || !hasContact …; hint only when name typed
sed -n 233,239p front-end/islands/ClientsPage.tsx  # name-only allowed here
sed -n 263,272p backend/src/agents/domain/coordinators/handle-wizard-answer/mod.ts   # raw English throw
```

## Red test
`cd cypress && npx cypress run --spec e2e/ux-assistant-pick-customer.cy.ts` after adding the `[data-cy=cust-create-from-search]` case.
