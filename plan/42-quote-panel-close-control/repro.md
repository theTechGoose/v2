# Repro — the /quotes?open= panel cannot be closed

## Steps
1. `deno task serve`; log in; on `/quotes` click a decided quote (or visit `/quotes?open=<id>`).
2. The detail panel opens with the title, badge, Copy link, View as client — no X, no Back. Browser back leaves the page entirely.
3. Compare `/invoices?open=<id>`: the invoice panel has an X that also strips `?open=` from the URL.

## Confirm in code
```
sed -n 164,201p front-end/islands/QuotesPage.tsx      # no close control
grep -n "onClose\|close" front-end/islands/QuotesPage.tsx || echo "zero hits"
sed -n 1145,1152p front-end/islands/InvoicesPage.tsx; sed -n 415,427p front-end/islands/InvoicesPage.tsx   # the model to copy
```

## Red test
new `cypress/e2e/quotes-open-panel.cy.ts` → `[data-cy=quote-panel-close]` does not exist.
