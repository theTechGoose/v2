# Repro — "01 The deal in plain English" still renders; p57 says delete it, p82 says rename it

## Steps
1. `deno task serve`; send a quote; open `/q/<id>`.
2. Sections read: 01 The deal in plain English · 02 Job Details · 03 Payment Schedule · 04 Terms · 05 Sign here.
   p57 ("Remove … the 'in plain English' sub-header … 02 Payment Schedule and 03 Terms stay the same") expects it gone and the numbers shifted up.
   p82 expects the same block titled "Quick Summary".

## Confirm in code
```
sed -n 411p front-end/components/quote-doc.tsx; sed -n 864,865p lang/en.json
grep -rn "Quick Summary\|Resumen rápido" lang/ || echo "no such string"
```
