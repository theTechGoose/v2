# Repro — the customer-doc footer shows the contractor's phone/email (by design of p61)

## Steps
1. `deno task serve`; log in as a contractor with phone + email in Settings; send a quote; open `/q/<id>` as the customer.
2. Footer: "Questions before signing? Call <your phone> or email <your email>! I look forward to working with you." Same on `/i/<id>`.
3. Log in as a contractor with NO email/phone → the footer disappears entirely (gated on having a contact).
4. p24 asks for `hello@paperworkmonster.com` / 866-767-8399 instead; p61 (completed) asked for exactly what renders today. That is the decision.

## Confirm in code
```
sed -n 696,742p front-end/components/quote-doc.tsx
sed -n 508,548p 'front-end/routes/i/[id].tsx'
grep -rn "hello@paperworkmonster.com\|866-767-8399" --include=*.ts --include=*.tsx --include=*.json . | grep -v node_modules | grep -v ui-breakdown   # only the landing footer has the 866 number
```
