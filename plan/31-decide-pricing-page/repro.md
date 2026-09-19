# Repro — the pricing page follows the Aug-31 recap, not page 34

## Steps
1. `deno task serve`; open `http://localhost:5280/#pricing` (and `/landing`).
2. Cards: Monster Free $0 / Monster $99 / Monster Assist $199 / Monster Projects (custom). No $15 Starter, no "Netflix" line, no "%".
3. Page 34 asks: no Free tier, $15 Starter, $99, $199. The recap that shipped (`shared/quote-flow/pricing-plans.ts:2-10` cites "PM – Meeting Recap & Action Items August 27-28, 2026") says otherwise.

## Confirm in code
```
sed -n 1,12p shared/quote-flow/pricing-plans.ts
git log --oneline -3 -- shared/quote-flow/pricing-plans.ts     # 6492671, a0ec81d
grep -n "15\|Starter\|Netflix" lang/en.json | grep -i "pricing\|plan" || echo "no $15 / Starter / Netflix copy"
```
