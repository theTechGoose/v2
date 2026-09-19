# Repro — Basic/Standard/Premium, no ZIP, no materials basis

## Steps
1. Put `OPENAI_API_KEY` in `.env`; `deno task serve`; log in; in `/settings` save a mailing address with city Austin, TX 78701.
2. `/assistant` → "I know the job, help me price it." → type
   `Paint a 2,000 sq ft house interior, two coats, baseboard and crown molding, 12 door jambs, 15 windows, all ceilings` → send → confirm the details.
3. Read the three price cards.
4. **Actual:** labels "Basic / Standard / Premium" with rationales like "Basic paint job with minimal prep"; numbers around $3,000 / $4,500 / $6,000; nothing says whether materials are included.
   **Expected (p7, p21):** Competitive / Market / Premium with the client's definitions, priced for 78701, and a visible "prices include labor and materials" line.

## Prove the ZIP never reaches the model
```
sed -n 85,99p backend/src/agents/entrypoints/job-details-controller/mod.ts   # passes {userId, raw, lang} only
sed -n 54,63p backend/src/agents/domain/coordinators/suggest-prices/mod.ts    # content = "Raw job description:\n<raw>"
sed -n 1773p lang/en.json | grep -o "labor\|material\|ZIP\|zip" || echo "prompt mentions none of these"
sed -n 96,98p backend/src/agents/domain/coordinators/suggest-prices/mod.ts    # the model's English label overrides the Spanish one
```
Switch the app language to Spanish and repeat step 2 → the tier labels come back in English ("Basic…") whenever the model echoes its own label.

## Under the stub (no key) you get the fallback constants
$500 / $850 / $1,200 (`suggest-prices/mod.ts:126-146`). The client's 3000/4500/6000 were live `gpt-4o-mini` output.

## Red tests
- `cd backend && deno test -A --unstable-kv src/agents/domain/coordinators/suggest-prices/int.test.ts` (new).
- `cd jest && npx jest integration/suggest-prices.int.test.ts` (new, dev server up).
- `cd cypress && npx cypress run --spec e2e/quotes-help-me-price.cy.ts` after adding the label + basis assertions.
