# Repro — customer phone fields do not format as you type

## Steps
1. `deno task serve`; open `/login` and type `5125556999` → it becomes `(512) 555-6999` as you type (mask exists here).
2. Log in; go to `/clients` → add customer → type the same digits into the phone field.
3. **Expected:** `(512) 555-6999` as you type. **Actual:** raw digits. Same on `/assistant` "+ New customer" and the `/invoices` new-invoice modal.

## Confirm in code
```
sed -n 12,18p front-end/islands/LoginForm.tsx             # private mask #1
sed -n 11,17p front-end/islands/TrialSignup.tsx           # private mask #2
sed -n 586,592p front-end/islands/LandingScripts.tsx      # private mask #3
sed -n 198,204p front-end/islands/ClientsPage.tsx         # raw value
sed -n 7809,7816p front-end/islands/AsstChat.tsx          # raw value
grep -n "formatPhoneInput" shared/quote-flow/format-helpers.ts   # nothing: only the display formatter exists
```

## Red tests
- `cd jest && npx jest unit/format-helpers.test.ts` after adding the `formatPhoneInput` cases (not exported yet).
- `cd cypress && npx cypress run --spec e2e/clients-page-quality.cy.ts` after adding the mask case.
