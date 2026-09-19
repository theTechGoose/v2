# Repro — three asks that are scope decisions, not defects

## NW-51c Spanish dialects
```
grep -c "usted" lang/es.json          # 0 — the dictionary is tú-form neutral LatAm
grep -c "cotización" lang/es.json     # ~107
grep -n "export type Lang" front-end/lib/lang.ts   # "en" | "es" — no dialect axis
```
## NW-56 "keep the ability to draft contracts"
```
cat front-end/routes/contracts/index.tsx           # a 302 to /quotes
grep -rln "class Contract\|ContractStore" backend/src || echo "no contract entity"
```
There is no standalone contract feature to keep; the Quote + Agreement is the contract.
## NW-58 import
```
grep -rn "import" backend/src/paperwork/entrypoints/invoice-controller/mod.ts | grep -iv "^.*import {" || echo "export.csv only; no import endpoint"
grep -rln "csv" front-end/islands | head
```
