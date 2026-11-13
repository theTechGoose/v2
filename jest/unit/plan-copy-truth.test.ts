/**
 * REQ-733 — demo-loop cycle 5, issues m17 "Plan lists disagree with what Free allows" and c1-m42
 * "E-signatures listed only under $99 plan yet Free-plan account could sign".
 * Raphael: "fix every issue the demo found, loop until there are none."
 *
 * RCA (cycle 5, at 2444608a): there is no plan gating in backend/src — a Free account adds
 * workers, signs electronically, sends by SMS and email, tracks payments and makes change
 * orders. The Monster card still listed those as its own lines, and REQ-607 had added a Monster
 * line saying "on every plan, Free included" — a Monster bullet saying it is not Monster's.
 * The fix: the plan lists describe the product as it is. Those lines are Free's (after REQ-109's
 * three dictated lines, word for word), Monster inherits them through "Everything in Monster
 * Free", and no line says "Free included". Real gating is the owner's call (REQ-607).
 * Target: shared/quote-flow/pricing-plans.ts (projected by front-end/lib/landing-dict.ts)
 */
import { LANDING_DICT } from "../../front-end/lib/landing-dict";
import {
  planById,
  planFeatures,
  PRICING_PLANS,
  PUBLIC_PLANS,
} from "../../shared/quote-flow/pricing-plans";
import en from "../../lang/en.json";
import es from "../../lang/es.json";

/** what every account has today, plan or no plan (no gating exists in backend/src) */
const EVERY_PLAN = [
  "workers-field-schedule",
  "e-signatures",
  "sms-email-sending",
  "payment-tracking",
  "change-orders",
];

describe("REQ-733 (demo m17 + c1-m42, cycle 5) — the plan lists say what Free really has", () => {
  it("REQ-733 Monster Free lists e-signatures, sending, payment tracking, change orders and workers", () => {
    const ids = planById("free").features.map((f) => f.id);
    for (const id of EVERY_PLAN) expect(ids).toContain(id);
  });

  it("REQ-733 no other plan lists them as its own line — Monster inherits them through 'Everything in Monster Free'", () => {
    for (const p of PRICING_PLANS.filter((p) => p.id !== "free")) {
      for (const f of p.features) expect(EVERY_PLAN).not.toContain(f.id);
    }
    expect(planById("monster").features[0].id).toBe("everything-in-free");
  });

  it("REQ-733 no line says 'Free included' — a paid card never carries a line that is not its own", () => {
    for (const p of PRICING_PLANS) {
      for (const f of p.features) {
        expect(f.en).not.toMatch(/Free included|every plan/i);
        expect(f.es).not.toMatch(/Free incluido|todos los planes/i);
      }
    }
  });

  it("REQ-733 REQ-109's three dictated lines still lead Free's list, word for word, in en and es", () => {
    expect(planFeatures("free", "en").slice(0, 3)).toEqual([
      "Unlimited invoices",
      "Up to five quotes and contracts a month",
      "Spanish and English output",
    ]);
    expect(planFeatures("free", "es").slice(0, 3)).toEqual([
      "Facturas ilimitadas",
      "Hasta cinco cotizaciones y contratos al mes",
      "Documentos en español y en inglés",
    ]);
  });

  it("REQ-733 the landing pages project e-signatures onto the Free tier and never onto Monster, both languages", () => {
    const free = PUBLIC_PLANS.findIndex((p) => p.id === "free") + 1;
    const monster = PUBLIC_PLANS.findIndex((p) => p.id === "monster") + 1;
    for (const lang of ["en", "es"] as const) {
      const d = LANDING_DICT[lang];
      const freeLines = Object.keys(d).filter((k) => k.startsWith(`price.t${free}.f`)).map((k) => d[k]);
      const monsterLines = Object.keys(d).filter((k) => k.startsWith(`price.t${monster}.f`)).map((k) => d[k]);
      expect(freeLines).toContain(lang === "en" ? "E-signatures" : "Firmas electrónicas");
      expect(monsterLines).not.toContain(lang === "en" ? "E-signatures" : "Firmas electrónicas");
    }
  });

  it("REQ-733 the client toggle's dictionaries (lang/*.json landing.price.*) agree: e-signatures under Free, not Monster, en and es in sync", () => {
    for (const d of [en, es] as Record<string, string>[]) {
      const monster = Object.keys(d).filter((k) => k.startsWith("landing.price.t2.f")).map((k) => d[k]);
      const free = Object.keys(d).filter((k) => k.startsWith("landing.price.t1.f")).map((k) => d[k]);
      expect(monster.some((v) => /E-signatures|Firmas electr/.test(v))).toBe(false);
      expect(free.some((v) => /E-signatures|Firmas electr/.test(v))).toBe(true);
    }
    const keys = (d: Record<string, string>) => Object.keys(d).filter((k) => k.startsWith("landing.price.")).sort();
    expect(keys(en as Record<string, string>)).toEqual(keys(es as Record<string, string>));
  });
});
