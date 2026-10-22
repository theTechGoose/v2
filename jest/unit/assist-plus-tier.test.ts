/**
 * REQ-118 — Raphael, 2026-10-22: "add another tier called monster assist + 399".
 *
 * Monster Assist+ is a public $399/month tier of the ONE plan list
 * (shared/quote-flow/pricing-plans.ts), and the two older landing pages price it the way they
 * price the others: "/" through the one landing dictionary (front-end/lib/landing-dict.ts —
 * `price.t4.*` is Monster Assist+ now, Monster Projects moves to `price.t5.*`, the features
 * projected by tier) and "/landing" through lang/*.json's `promoLanding.pricingAssistPlus*`
 * keys. Five cards each, in the list's order, no price typed by hand, and a grid that holds five.
 * /landing2's fourth card is pinned in landing2-page.test.ts; the backend's rules in
 * backend/src/users/domain/business/plan/test.ts.
 */
import * as fs from "fs";
import * as path from "path";
import { LANDING_DICT } from "../../front-end/lib/landing-dict";
import { planById, PUBLIC_PLANS } from "../../shared/quote-flow/pricing-plans";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

describe("REQ-118 Monster Assist+ on the two older landing pages", () => {
  const plus = planById("assist-plus");
  const projects = planById("projects");

  test("the front page's dictionary: t4 is Monster Assist+ with a figure and t5 is Monster Projects with the Custom word, in both languages, the features projected by tier", () => {
    expect(PUBLIC_PLANS[3].id).toBe("assist-plus");
    expect(PUBLIC_PLANS[4].id).toBe("projects");
    for (const lang of ["en", "es"] as const) {
      const d = LANDING_DICT[lang];
      expect(d["price.t4.name"]).toBe("Monster Assist+");
      expect(typeof d["price.t4.blurb"]).toBe("string");
      expect(d["price.t4.blurb"].length).toBeGreaterThan(10);
      expect(d["price.t4.price"]).toBeUndefined(); // a figure from the list, never a word
      expect(d["price.t5.name"]).toBe("Monster Projects");
      expect(d["price.t5.price"]).toBe(lang === "es" ? "A medida" : "Custom");
      expect(typeof d["price.t5.blurb"]).toBe("string");
      plus.features.forEach((f, i) => expect(d[`price.t4.f${i + 1}`]).toBe(lang === "es" ? f.es : f.en));
      projects.features.forEach((f, i) => expect(d[`price.t5.f${i + 1}`]).toBe(lang === "es" ? f.es : f.en));
    }
    expect(LANDING_DICT.en["price.t4.blurb"]).toBe(plus.blurb);
    expect(LANDING_DICT.en["price.t5.blurb"]).toBe(projects.blurb);
    expect(LANDING_DICT.es["price.t4.blurb"]).not.toBe(LANDING_DICT.en["price.t4.blurb"]);
  });

  test("the front page renders five tier cards from the list — Monster Assist+ fourth with the list's $399, Projects fifth as the custom card — and its grid holds five", () => {
    const src = read("front-end/routes/index.tsx");
    expect(src).toMatch(/TIER_PRICE\["assist-plus"\]/);
    expect(src).toMatch(/PUBLIC_PLANS\[3\]\.features/);
    expect(src).toMatch(/PUBLIC_PLANS\[4\]\.features/);
    expect(src).toMatch(/data-i18n="price\.t4\.name"/);
    expect(src).toMatch(/data-i18n="price\.t5\.name"/);
    expect(src).toMatch(/data-i18n="price\.t5\.price"/);
    expect(src).not.toMatch(/data-i18n="price\.t4\.price"/);
    expect(src).not.toMatch(/\$399/);
    expect(read("front-end/static/landing.css")).toMatch(
      /\.pricing-tiers \{\s*display: grid;\s*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/,
    );
  });

  test("/landing: Monster Assist+ is named and described in both languages and rendered fourth with the list's $399; Projects is fifth; five cards fit the row", () => {
    for (const d of [en, es]) {
      expect(d["promoLanding.pricingAssistPlusName"]).toBe("Monster Assist+");
      expect(typeof d["promoLanding.pricingAssistPlusBlurb"]).toBe("string");
      expect(d["promoLanding.pricingAssistPlusBlurb"].length).toBeGreaterThan(10);
    }
    expect(en["promoLanding.pricingAssistPlusBlurb"]).not.toBe(es["promoLanding.pricingAssistPlusBlurb"]);
    const src = read("front-end/routes/landing.tsx");
    expect(src).toMatch(/TIER_PRICE\["assist-plus"\]/);
    expect(src).toMatch(/t\("pricingAssistPlusName"\)/);
    expect(src).toMatch(/t\("pricingAssistPlusBlurb"\)/);
    expect(src).toMatch(/PUBLIC_PLANS\[3\]\.features/);
    expect(src).toMatch(/PUBLIC_PLANS\[4\]\.features/);
    expect(src).not.toMatch(/\$399/);
    expect(read("front-end/static/promo.css")).toMatch(/\.pm-plan \{[^}]*flex: 1 1 180px;/);
  });
});
