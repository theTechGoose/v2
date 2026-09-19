# Repro — the clause list is headed "Terms" on the web page and "Fine print, in plain English" on the PDF

## Steps
1. `deno task serve`; create and send any quote; open `/q/<id>`.
2. Scroll to the numbered clauses: the heading reads "Terms".
3. Download the PDF from the same page: section 05 reads "Fine print, in plain English".
4. **Expected (p62):** "Terms and Conditions" in both.

## Confirm in code
```
sed -n 140p front-end/components/quote-doc.tsx; sed -n 902p lang/en.json          # "Terms"
sed -n 472,483p backend/src/paperwork/domain/coordinators/render-quote-pdf/mod.ts; sed -n 2165p lang/en.json   # PDF heading
grep -rn "Terms and Conditions\|Términos y Condiciones" lang/ || echo "no such string"
```

## Red tests
- `cd jest && npx jest unit/i18n-dictionary-consistency.test.ts` after adding the `quoteDoc.termsAndConditions` assertion.
- `cd cypress && npx cypress run --spec e2e/public-quote-signature.cy.ts` after adding `cy.contains("Terms and Conditions")`.
