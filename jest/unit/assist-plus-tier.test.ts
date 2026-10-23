/**
 * REQ-118 — Raphael, 2026-10-22: "add another tier called monster assist + 399".
 * REQ-119 — Raphael, 2026-10-23: "the monster assist + is a hidden item that can only be shown in
 * the settings upgrade panel not on the onboarding panel."
 *
 * Monster Assist+ is a $399/month tier of the ONE plan list (shared/quote-flow/pricing-plans.ts)
 * that is HIDDEN: `public: false`, so the two older landing pages do not price it — "/" through the
 * one landing dictionary (front-end/lib/landing-dict.ts — Monster Projects is `price.t4.*` with the
 * Custom word, there is no fifth tier) and "/landing" through lang/*.json (no
 * `promoLanding.pricingAssistPlus*` keys). Four cards each, in the list's order, and a grid that
 * holds four. Onboarding's plan step shows ONBOARDING_PLANS (the public monthly plans); the
 * settings upgrade panel shows UPGRADE_PLANS — the one place Monster Assist+ is a card. /landing2's
 * three cards are pinned in landing2-page.test.ts; the backend's rules in
 * backend/src/users/domain/business/plan/test.ts; the pages themselves in
 * e2e/plan-picker/plan-picker.e2e.test.ts.
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

describe("REQ-119 Monster Assist+ is hidden from the two older landing pages", () => {
  const projects = planById("projects");

  test("the front page's dictionary: four tiers — t4 is Monster Projects with the Custom word, no t5, no Monster Assist+ in either language, the features projected by tier; the client toggle's key list agrees", () => {
    expect(PUBLIC_PLANS.map((p) => p.id)).toEqual(["free", "monster", "assist", "projects"]);
    for (const lang of ["en", "es"] as const) {
      const d = LANDING_DICT[lang];
      expect(d["price.t4.name"]).toBe("Monster Projects");
      expect(d["price.t4.price"]).toBe(lang === "es" ? "A medida" : "Custom");
      expect(typeof d["price.t4.blurb"]).toBe("string");
      projects.features.forEach((f, i) => expect(d[`price.t4.f${i + 1}`]).toBe(lang === "es" ? f.es : f.en));
      expect(Object.keys(d).filter((k) => k.startsWith("price.t5."))).toEqual([]);
      expect(Object.values(d).some((v) => /Assist\+/.test(v))).toBe(false);
    }
    expect(LANDING_DICT.en["price.t4.blurb"]).toBe(projects.blurb);
    // the client-side toggle (LandingScripts) reads lang/*.json's landing.price.t4.* — the custom card — and knows no t5
    const keys = read("front-end/islands/LandingScripts.tsx");
    expect(keys).toMatch(/"price\.t4\.price"/);
    expect(keys).not.toMatch(/price\.t5\./);
    for (const d of [en, es]) {
      expect(d["landing.price.t4.name"]).toBe("Monster Projects");
      expect(Object.keys(d).filter((k) => k.startsWith("landing.price.t5."))).toEqual([]);
    }
  });

  test("the front page renders four tier cards from the list — Projects fourth as the custom card, no $399 — and its grid holds four", () => {
    const src = read("front-end/routes/index.tsx");
    expect(src).not.toMatch(/assist-plus/);
    expect(src).not.toMatch(/Assist\+/);
    expect(src).not.toMatch(/PUBLIC_PLANS\[4\]/);
    expect(src).toMatch(/PUBLIC_PLANS\[3\]\.features/);
    expect(src).toMatch(/data-i18n="price\.t4\.name"/);
    expect(src).toMatch(/data-i18n="price\.t4\.price"/);
    expect(src).not.toMatch(/price\.t5\./);
    expect(src).not.toMatch(/\$399/);
    const css = read("front-end/static/landing.css");
    expect(css).toMatch(
      /\.pricing-tiers \{\s*display: grid;\s*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);\s*gap: 20px;\s*align-items: stretch;\s*max-width: 1200px;/,
    );
    expect(css).not.toMatch(/1180px/);
  });

  test("/landing: no Monster Assist+ name or blurb in either language, four cards rendered from the list with Projects fourth, four cards fit the row at 220px", () => {
    for (const d of [en, es]) {
      expect(d["promoLanding.pricingAssistPlusName"]).toBeUndefined();
      expect(d["promoLanding.pricingAssistPlusBlurb"]).toBeUndefined();
      expect(Object.keys(d).filter((k) => /AssistPlus/.test(k))).toEqual([]);
    }
    const src = read("front-end/routes/landing.tsx");
    expect(src).not.toMatch(/assist-plus|AssistPlus|Assist\+/);
    expect(src).not.toMatch(/PUBLIC_PLANS\[4\]/);
    expect(src).toMatch(/PUBLIC_PLANS\[3\]\.features/);
    expect(src).not.toMatch(/\$399/);
    expect(read("front-end/static/promo.css")).toMatch(/\.pm-plan \{[^}]*flex: 1 1 220px;/);
  });
});

describe("REQ-119 the settings upgrade panel is the one place Monster Assist+ is a card", () => {
  test("onboarding's plan step renders ONBOARDING_PLANS and the settings Plan panel UPGRADE_PLANS — neither re-derives its cards from PUBLIC_PLANS", () => {
    const wizard = read("front-end/islands/WelcomeWizard.tsx");
    expect(wizard).toMatch(/import \{[^}]*\bONBOARDING_PLANS\b[^}]*\} from "\.\.\/\.\.\/shared\/quote-flow\/pricing-plans\.ts"/);
    expect(wizard).toMatch(/const plans = ONBOARDING_PLANS;/);
    expect(wizard).not.toMatch(/PUBLIC_PLANS|UPGRADE_PLANS/);
    const settings = read("front-end/islands/SettingsPage.tsx");
    expect(settings).toMatch(/import \{[^}]*\bUPGRADE_PLANS\b[^}]*\} from "\.\.\/\.\.\/shared\/quote-flow\/pricing-plans\.ts"/);
    expect(settings).toMatch(/const selectable = UPGRADE_PLANS;/);
    expect(settings).not.toMatch(/PUBLIC_PLANS|ONBOARDING_PLANS/);
  });

  test("no sign-up names it with the code: the front-end carries no sign-up plan at all (REQ-120)", () => {
    const profile = read("front-end/clients/profile.ts");
    expect(profile).not.toMatch(/signupPlan/);
    expect(profile).not.toMatch(/assist-plus/);
  });
});
