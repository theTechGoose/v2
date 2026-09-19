# Repro — three small divergences on items marked complete

## NW-53f price autofocus in "help me price it"
1. `/assistant` → "I know the job, help me price it." → details → confirm → pick a tier.
2. The price field is NOT focused (it is in the "I know my price" flow). `grep -n 'autoFocus={!suggestPricing}' front-end/islands/AsstChat.tsx`.

## NW-53b composer hidden — no negative pin
`grep -rn 'composer__input").should("not.exist"' cypress/e2e || echo "no spec asserts the composer is absent"`; the behaviour itself is correct (`AsstChat.tsx:7262-7266`).

## NW-48 SMS link inline
Send a quote by text; the message reads "…is ready: <link> Please let me know…" on one line. p45's template puts the link on its own line.
`sed -n 1588,1595p lang/en.json` — `{url}` follows "is ready:" with a space, not a newline.

## Red tests
- `cd cypress && npx cypress run --spec e2e/quotes-help-me-price.cy.ts` after adding `cy.focused()` on the money input.
- `cd jest && npx jest unit/sms-template.test.ts` after asserting the URL is on its own line.
