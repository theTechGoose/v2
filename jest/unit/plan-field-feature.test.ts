/**
 * REQ-515 — demo-loop cycle 3, issue m53: "Plan cards say nothing about workers or field".
 * Pair 8 at onboarding step 4: "Free / Monster $99 / Assist $199 list only quotes, invoices and
 * e-signatures, so as a crew owner I can't tell which plan includes worker logins."
 *
 * Field (workers, the field schedule) is not plan-gated, so every paid plan carries it: Monster
 * names it, and Monster Assist / Monster Assist+ inherit it through "Everything in Monster" /
 * "Everything in Monster Assist". The wizard and settings cards show only a plan's FIRST THREE
 * features (front-end/components/PlanCards.tsx), so the line must sit in Monster's first three;
 * the landing pages project the whole list (front-end/lib/landing-dict.ts).
 * Target: shared/quote-flow/pricing-plans.ts
 */
import { LANDING_DICT } from "../../front-end/lib/landing-dict";
import {
  planById,
  planFeatures,
  PUBLIC_PLANS,
} from "../../shared/quote-flow/pricing-plans";

const FIELD_ID = "workers-field-schedule";
const MONSTER_EN = "Workers & field schedule — on every plan, Free included";
const MONSTER_ES = "Trabajadores y agenda de campo — en todos los planes, Free incluido";

describe("REQ-515 (demo m53, cycle 3) — the paid plans say they include workers & the field schedule", () => {
  it("REQ-515 / REQ-607 Monster carries the workers & field schedule line in en and es, saying it is on every plan", () => {
    const line = planById("monster").features.find((f) => f.id === FIELD_ID);
    expect(line).toBeDefined();
    expect(line!.en).toBe(MONSTER_EN);
    expect(line!.es).toBe(MONSTER_ES);
    expect(planFeatures("monster", "en")).toContain(MONSTER_EN);
    expect(planFeatures("monster", "es")).toContain(MONSTER_ES);
  });

  it("REQ-515 the line is in Monster's first three — the onboarding/settings cards show only three", () => {
    const firstThree = planById("monster").features.slice(0, 3).map((f) => f.id);
    expect(firstThree).toContain(FIELD_ID);
  });

  it("REQ-515 Monster Assist and Monster Assist+ inherit it through the 'Everything in' chain", () => {
    expect(planById("assist").features[0].id).toBe("everything-in-monster");
    expect(planById("assist-plus").features[0].id).toBe("everything-in-assist");
  });

  it("REQ-515 the landing pages project the same line onto the Monster tier, both languages", () => {
    const tier = PUBLIC_PLANS.findIndex((p) => p.id === "monster") + 1;
    const n = planById("monster").features.findIndex((f) => f.id === FIELD_ID) + 1;
    expect(n).toBeGreaterThan(0);
    expect(LANDING_DICT.en[`price.t${tier}.f${n}`]).toBe(MONSTER_EN);
    expect(LANDING_DICT.es[`price.t${tier}.f${n}`]).toBe(MONSTER_ES);
  });

  it("REQ-515 / REQ-607 Monster Free's three REQ-109 lines are unchanged — Raphael dictated them", () => {
    expect(planById("free").features.map((f) => f.id)).toEqual([
      "unlimited-invoices",
      "five-quotes",
      "spanish-in-english-out",
    ]);
  });
});

/**
 * REQ-607 — demo-loop cycle 4, issue m27: "Worker features open on Free plan". Field is not
 * plan-gated (no plan check in backend/src/field, routes/field/_middleware.ts or the nav), so a
 * Free account adds workers and uses the field schedule — but REQ-515 put a bare "Workers & field
 * schedule" line on Monster only, so the pricing copy implied a paid feature Free already has.
 * Field stays ungated until Raphael decides otherwise. Free's own lines are REQ-109's dictated
 * three, so the fix is Monster's wording: it says the feature is on every plan, Free included.
 */
describe("REQ-607 (demo m27, cycle 4) — the pricing copy does not imply field is Monster-only", () => {
  it("REQ-607 Monster's line says field is on every plan, Free included, in en and es", () => {
    const line = planById("monster").features.find((f) => f.id === FIELD_ID)!;
    expect(line.en).toMatch(/every plan/i);
    expect(line.en).toMatch(/Free included/);
    expect(line.es).toMatch(/todos los planes/i);
    expect(line.es).toMatch(/Free incluido/);
  });

  it("REQ-607 the landing pages carry the same every-plan wording on the Monster tier, both languages", () => {
    const tier = PUBLIC_PLANS.findIndex((p) => p.id === "monster") + 1;
    const n = planById("monster").features.findIndex((f) => f.id === FIELD_ID) + 1;
    expect(LANDING_DICT.en[`price.t${tier}.f${n}`]).toMatch(/every plan, Free included/);
    expect(LANDING_DICT.es[`price.t${tier}.f${n}`]).toMatch(/todos los planes, Free incluido/);
  });

  it("REQ-607 no plan card presents field as a bare line, which would read as that plan's upgrade", () => {
    for (const p of PUBLIC_PLANS) {
      for (const f of p.features) {
        if (/field schedule/i.test(f.en)) expect(f.en).toMatch(/every plan/i);
        if (/agenda de campo/i.test(f.es)) expect(f.es).toMatch(/todos los planes/i);
      }
    }
  });
});
