# 6.4 ❓ NW-37 — Pricing page: $15 Starter / no Free (p34) or Hans's 2026-08-31 recap (Free $0 / $99 / $199 / custom) that shipped?

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 6.4) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

`shared/quote-flow/pricing-plans.ts:2-10` documents the recap as the source; commits `6492671`, `a0ec81d`; pinned by `jest/unit/pricing-plans.test.ts:24-38` and `cypress/e2e/landing-pricing.cy.ts:28-75`.
- If it flips back: edit `pricing-plans.ts`, both dicts (`lang/en.json:1366-1396`, `:1737-1751`), and both tests. No "%" anywhere either way. (S/M)

## Phase context (verbatim from the plan, `Phase 6 — ❓ Decisions the client must make, with the work each answer unlocks`)

Send §10 (the message at the bottom) to the client. Do not start these tasks until the answer is back; everything above is unblocked meanwhile.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- **NW-37:** the $15-Starter / no-Free pricing ask is superseded by Hans's 2026-08-31 recap that shipped (Free $0 / $99 / $199 /
  custom). Which one stands?

- **Pricing** [p34]
  - No Free tier.
  - Get rid of the % for now.
  - Starter package at $15 per month: "We can legitimize your business for less than a Netflix no-ad subscription", quotes etc.
  - $99 and $199 tiers.
  - **NW-37 ❓ SUPERSEDED — half done, half deliberately not.** `shared/quote-flow/pricing-plans.ts:2-10` records that Hans's
    "PM – Meeting Recap & Action Items August 27-28, 2026" (sent 2026-08-31) replaced this page: Monster Free $0 / Monster $99 /
    Monster Assist $199 / Monster Projects custom, Assist Plus hidden (`:73-216`); rendered `routes/index.tsx:33-41,870-1010` and
    `routes/landing.tsx:236-331`; copy `lang/en.json:1366-1396`, `:1737-1751`. No "%" in any pricing key; no "$15", "Starter" or
    "Netflix" anywhere. Commits `6492671`, `a0ec81d`. Pinned by `jest/unit/pricing-plans.test.ts:24-38`, `cypress/e2e/landing-pricing.cy.ts:28-75`.
    Decision needed; if it flips back: `pricing-plans.ts` + both dicts + both tests. Effort S/M.

## Code at the cited lines (read from this tree while packaging)

### `shared/quote-flow/pricing-plans.ts:2-10`

```
2:  * Pricing & offerings — set by Hans's "PM – Meeting Recap & Action Items
3:  * August 27-28, 2026" email (sent Aug 31, 2026), which supersedes the
4:  * raw-plan p20 deck (no free tier, $15 Starter / $99 / $199):
5:  *
6:  *   Monster Free         $0/month         unlimited invoices, max 5 quotes/month
7:  *   Monster              $99/month        the full self-service platform
8:  *   Monster Assist       $199/month       platform + phone/text/email help
9:  *   Monster Projects     custom           scoped per customer — no number shown
10:  *   Monster Assist Plus  $399–$599/month  higher-level expert assistance    HIDDEN
```

### `jest/unit/pricing-plans.test.ts:24-38`

```
24:   it("lists exactly four PUBLIC plans, in site order", () => {
25:     expect(PUBLIC_PLANS.map((p) => p.id)).toEqual([
26:       "free",
27:       "monster",
28:       "assist",
29:       "projects",
30:     ]);
31:     expect(PUBLIC_PLANS.map((p) => p.name)).toEqual([
32:       "Monster Free",
33:       "Monster",
34:       "Monster Assist",
35:       "Monster Projects",
36:     ]);
37:     expect(PUBLIC_PLANS.every((p) => p.public)).toBe(true);
38:   });
```

### `cypress/e2e/landing-pricing.cy.ts:28-75`

```
28:     const plan = (n: number) => cy.get("#pricing [data-cy=pricing-plan]").eq(n);
29: 
30:     it("shows exactly the four public plans, in order", () => {
31:       pricing().within(() => {
32:         cy.get("[data-cy=pricing-plan]").filter(":visible").should(
33:           "have.length",
34:           4,
35:         );
36:         cy.get("[data-cy=pricing-plan-name]").then(($names) => {
37:           const names = [...$names].map((el) => (el.textContent ?? "").trim());
38:           expect(names).to.deep.equal([
39:             "Monster Free",
40:             "Monster",
41:             "Monster Assist",
42:             "Monster Projects",
43:           ]);
44:         });
45:       });
46:     });
47: 
48:     it("Monster Free is $0 a month and leads with Unlimited invoices; max 5 quotes", () => {
49:       plan(0).within(() => {
50:         cy.contains(/\$0\b/).should("be.visible");
51:         cy.get("li").first().invoke("text").should(
52:           "match",
53:           /unlimited invoices/i,
54:         );
55:         cy.contains(/5 quotes/i).should("be.visible");
56:       });
57:     });
58: 
59:     it("Monster is $99 a month", () => {
60:       plan(1).within(() => {
61:         cy.contains(/\$99\b/).should("be.visible");
62:       });
63:     });
64: 
65:     it("Monster Assist is $199 a month and on the site", () => {
66:       plan(2).within(() => {
67:         cy.contains(/\$199\b/).should("be.visible");
68:         cy.contains(/phone, text & email/i).should("be.visible");
69:       });
70:     });
71: 
72:     it("Monster Projects is the custom card — no dollar figure, a talk-to-us CTA", () => {
73:       plan(3).within(() => {
74:         cy.contains(/custom/i).should("be.visible");
75:         cy.contains(/\$\s?\d/).should("not.exist");
```

### `lang/en.json:1366-1396`

```
1366:   "landing.price.eyebrow": "Pricing",
1367:   "landing.price.permo": "/month",
1368:   "landing.price.plans.cta": "Get started",
1369:   "landing.price.plans.ctaCustom": "Talk to us",
1370:   "landing.price.plans.h2html": "Flat monthly pricing. <em>No surprises.</em>",
1371:   "landing.price.plans.lead": "Your whole back office — quotes, contracts, invoices, follow-ups — for one flat monthly price. No setup fees, cancel anytime.",
1372:   "landing.price.t1.blurb": "Unlimited invoices, free. Plus up to 5 quotes a month.",
1373:   "landing.price.t1.f1": "Unlimited invoices",
1374:   "landing.price.t1.f2": "Up to 5 quotes a month",
1375:   "landing.price.t1.f3": "Spanish in, English out",
1376:   "landing.price.t1.name": "Monster Free",
1377:   "landing.price.t2.badge": "Most popular",
1378:   "landing.price.t2.blurb": "The full self-service platform. Win more jobs and get paid faster — without the chasing.",
1379:   "landing.price.t2.f1": "Everything in Monster Free",
1380:   "landing.price.t2.f2": "Unlimited quotes, agreements & invoices",
1381:   "landing.price.t2.f3": "E-signatures",
1382:   "landing.price.t2.f4": "SMS & email sending",
1383:   "landing.price.t2.f5": "Payment tracking + nudges",
1384:   "landing.price.t2.f6": "Change orders",
1385:   "landing.price.t2.name": "Monster",
1386:   "landing.price.t3.blurb": "Everything in Monster, plus a real person on call by phone, text or email.",
1387:   "landing.price.t3.f1": "Everything in Monster",
1388:   "landing.price.t3.f2": "Phone, text & email help from our team",
1389:   "landing.price.t3.f3": "Hands-on help with your quotes, agreements & invoices",
1390:   "landing.price.t3.name": "Monster Assist",
1391:   "landing.price.t4.blurb": "For bigger or specialized work outside the standard plans. Scoped directly with you.",
1392:   "landing.price.t4.f1": "Large plan reviews & detailed takeoffs",
1393:   "landing.price.t4.f2": "Major estimates, complex bids & proposals",
1394:   "landing.price.t4.f3": "Monthly or performance-based — agreed with you",
1395:   "landing.price.t4.name": "Monster Projects",
1396:   "landing.price.t4.price": "Custom",
```

### `lang/en.json:1737-1751`

```
1737:   "promoLanding.pricingAssistBlurb": "Everything in Monster, plus a real person on call by phone, text or email.",
1738:   "promoLanding.pricingAssistName": "Monster Assist",
1739:   "promoLanding.pricingBadge": "Most popular",
1740:   "promoLanding.pricingCta": "Get Started",
1741:   "promoLanding.pricingCtaCustom": "Talk to us",
1742:   "promoLanding.pricingCustom": "Custom",
1743:   "promoLanding.pricingFreeBlurb": "Unlimited invoices, free. Plus up to 5 quotes a month.",
1744:   "promoLanding.pricingFreeName": "Monster Free",
1745:   "promoLanding.pricingH2": "Pricing",
1746:   "promoLanding.pricingMonsterBlurb": "The full self-service platform. Win more jobs and get paid faster — without the chasing.",
1747:   "promoLanding.pricingMonsterName": "Monster",
1748:   "promoLanding.pricingPerMonth": "/mo",
1749:   "promoLanding.pricingProjectsBlurb": "For bigger or specialized work outside the standard plans. Scoped directly with you.",
1750:   "promoLanding.pricingProjectsName": "Monster Projects",
1751:   "promoLanding.pricingSub": "Start free. Upgrade when you’re ready. No surprises.",
```
