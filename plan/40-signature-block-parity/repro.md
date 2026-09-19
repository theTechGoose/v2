# Repro — "you agree" instead of "<Name> agrees"; PDF lacks the sentence and uses "CLIENT SIGNED"

## Steps
1. `deno task serve`; log in; create a quote through the wizard but on the customer step bind NO customer (or create one whose name is blank — see folder 37 for why the client hit this); send; open `/q/<id>`.
2. Section "Sign here" reads "By signing below, **you** agree to everything above." With a bound customer it correctly reads "By signing below, Thing agrees…".
3. Switch the page to Spanish (`?lang=es`): the named sentence comes from i18n strings, not the shared module — the EN and ES paths are different code.
4. Download the PDF: no "By signing below…" sentence at all; boxes titled "CONTRACTOR" / "CLIENT SIGNED" instead of "CONTRACTOR SIGNATURE" / "YOUR SIGNATURE".

## Confirm in code
```
sed -n 222p front-end/components/quote-doc.tsx; sed -n 250,269p front-end/components/quote-doc.tsx   # customerName gate + lang==="en" forks
sed -n 805,806p lang/en.json                                                                            # both sentences exist
sed -n 544,559p backend/src/paperwork/domain/coordinators/render-quote-pdf/mod.ts; sed -n 2171,2175p lang/en.json   # PDF titles
```

## Red tests
- `cd jest && npx jest unit/signature-block.test.ts` after adding the `lang:"es"` case.
- `cd cypress && npx cypress run --spec e2e/public-quote-signature.cy.ts` after adding the ES named case.
