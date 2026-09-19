# Repro — the sidebar can collapse but has no control of its own

## Steps
1. `deno task serve`; log in; open `/dashboard` at ≥1280 px wide.
2. Look between the business name and Settings in the left rail: there is no collapse arrow (p36). The only way to collapse is the hamburger in the top bar; once collapsed, the rail has no expand control either.
3. Open `/assistant`: the conversations panel DOES have the QuickBooks-style button (hamburger ⇄ hamburger+arrow) — that is the pattern to copy.

## Confirm in code
```
sed -n 127,151p front-end/islands/DashSidebar.tsx     # state + toggle via the pm:sb-toggle event only
sed -n 318,325p front-end/islands/DashSidebar.tsx     # rail bottom: identity link only
sed -n 145,177p front-end/islands/AsstThreads.tsx     # the button to copy
grep -rn "sidebar-collapse\|sidebar-expand" front-end/islands || echo "data-cy expected by dashboard-assistant-access.cy.ts is never rendered"
```

## Red test
`cd cypress && npx cypress run --spec e2e/dashboard-assistant-access.cy.ts` after adding the `[data-cy=sidebar-collapse]` case.
