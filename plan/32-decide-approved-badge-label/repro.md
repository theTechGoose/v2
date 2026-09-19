# Repro — the badge says "Accepted" where the client wrote "Approved"

## Steps
1. `deno task serve`; send a quote; accept it as the customer on `/q/<id>`; open `/quotes`.
2. Badge reads "Accepted" (es "Aceptada"). Page 41 lists Draft → Sent → Viewed → **Approved**.

## Confirm in code
```
sed -n 53,61p shared/quote-flow/quote-status.ts   # BADGE_LABELS
sed -n 2447p lang/en.json; sed -n 2447p lang/es.json
sed -n 76,90p shared/quote-flow/email-format.ts   # a third label source
sed -n 5,7p shared/quote-flow/quote-status.ts     # the rationale for "Accepted"
```
The persisted value `"accepted"` is not what changes — only the three label sources.
