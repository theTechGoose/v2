# Repro — three copy divergences from pages 76–83 that were marked complete

## Steps
1. `deno task serve`; create a quote through the wizard; on the warranty step read the options.
   **Expected (p76):** No warranty / 6 months / 1 year / 2 years / Custom. **Actual:** "12 months" / "24 months".
2. Open `/q/<id>`; read clause 1 (Governing Law).
   **Expected (p80):** "…where the work is performed, without regard to conflict of law rules." **Actual:** stops at "performed."
3. Read clause 2's title. **Expected (p83):** "Scope of Work". **Actual:** "Job Details".

## Confirm in code
```
sed -n 937,939p lang/en.json          # warranty labels
sed -n 819p lang/en.json; sed -n 2129p lang/en.json   # governing-law body, web + PDF
grep -n "quoteDoc.clause.jobDetails.title" lang/en.json
sed -n 30,33p front-end/lib/term-i18n.ts   # month/week/day regex has no "year"
```

## Red test
`cd jest && npx jest unit/i18n-dictionary-consistency.test.ts` after adding the three value assertions.
