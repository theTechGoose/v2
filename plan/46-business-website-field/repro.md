# Repro — the From block has no website, and there is nowhere to enter one

## Steps
1. `deno task serve`; log in; open `/settings` → Business identity: fields for name, phone, email, address… no website.
2. Send a quote; open `/q/<id>`: the From card shows name/phone/email only. Same on the PDF and the email.

## Confirm in code
```
grep -n "website" backend/src/users/dto/business-identity.ts || echo "no field in the DTO"
grep -n "website" front-end/islands/SettingsPage.tsx || echo "no input in Settings"
grep -n "website" front-end/components/doc-parts.tsx || echo "no row in PartyCard"
sed -n 20p front-end/clients/profile.ts     # a dead FE-only websiteUrl? type
sed -n 878,903p backend/src/paperwork/entrypoints/public-controller/mod.ts   # PublicContractor: no website
```

## Red test
`cd cypress && npx cypress run --spec e2e/settings-editable.cy.ts` after adding `[data-cy=settings-website]`.
