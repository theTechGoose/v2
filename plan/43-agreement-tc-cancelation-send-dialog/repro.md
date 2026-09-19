# Repro — clauses always expanded; no Cancelation row; send channels are a caret menu with no Keep/Cancel

## Steps
1. `deno task serve`; send a quote; open `/q/<id>`.
   - The 14 clauses are an always-open numbered list; p63 asks for an expandable "Terms & Conditions" at the bottom.
   - The term grid shows Start / Time to complete / Payment / Warranty — no Cancelation row; the 7-day notice exists only as clause 10, and "work completed will be paid for" is absent.
2. In the assistant review card click the caret next to Send: a dropdown with "Text + Email / Email only / Text only / Copy link" — no title "How do you want to send to customer?", no Keep / Cancel.

## Confirm in code
```
sed -n 477,485p front-end/components/quote-doc.tsx                   # the <ol>
grep -c "<details\|<summary\|aria-expanded" front-end/components/quote-doc.tsx   # 0
sed -n 833,834p lang/en.json                                         # termination clause text
sed -n 486,493p front-end/islands/AsstChat.tsx                       # term rows: no cancellation
sed -n 6374,6380p front-end/islands/AsstChat.tsx; sed -n 316,319p lang/en.json   # the caret menu
grep -rn '"Keep' lang/en.json || echo "no Keep copy anywhere"
```

## Red tests
- `cd cypress && npx cypress run --spec e2e/public-quote-signature.cy.ts` (`details[data-cy=terms-details]`, Cancelation row).
- `cd cypress && npx cypress run --spec e2e/ux-send-moment.cy.ts` (`[data-cy=send-dialog]` with Keep/Cancel).
