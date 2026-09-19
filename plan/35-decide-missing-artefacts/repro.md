# Repro — five items whose source material is not in the repo

Run these to prove each is unlocatable, then ask the client for the artefact:

```
grep -rn "Yam" --include=*.ts --include=*.tsx --include=*.json . | grep -v node_modules | grep -v ui-breakdown | grep -v new-working-issues   # NW-21: nothing
git log --oneline -1 -- front-end/static/logo-monster.png                                                        # NW-53c: last change 8d7d222 (2026-08-18); no new asset
grep -rn "Contract for new job" --include=*.ts --include=*.tsx --include=*.json . | grep -v node_modules | grep -v ui-breakdown | grep -v new-working-issues   # NW-57: nothing
find . -name "*.docx" -not -path "*/node_modules/*"                                                                # NW-46: no "Quote & Agreement - Final.docx"
```
NW-53g ("We need a Quote and Agreement change") has no content in the PDF bullet.

## Most likely cause of "Yam" (NW-21), to confirm with the screenshot
`shared/quote-flow/quick-quote-prefill.ts:66-98` `extractCustomerName` lifts a Capitalized token after "for"/"para" and prefills the new-customer *value* (`AsstChat.tsx:4742`, `:7788`). Type `Replace a faucet for Yam, $300` on the details step and open "+ New customer" → the name field is prefilled "Yam".
