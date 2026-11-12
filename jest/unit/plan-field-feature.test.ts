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

describe("REQ-515 (demo m53, cycle 3) — the paid plans say they include workers & the field schedule", () => {
  it("REQ-515 Monster carries a 'Workers & field schedule' line in en and es", () => {
    const line = planById("monster").features.find((f) => f.id === FIELD_ID);
    expect(line).toBeDefined();
    expect(line!.en).toBe("Workers & field schedule");
    expect(line!.es).toBe("Trabajadores y agenda de campo");
    expect(planFeatures("monster", "en")).toContain("Workers & field schedule");
    expect(planFeatures("monster", "es")).toContain("Trabajadores y agenda de campo");
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
    expect(LANDING_DICT.en[`price.t${tier}.f${n}`]).toBe("Workers & field schedule");
    expect(LANDING_DICT.es[`price.t${tier}.f${n}`]).toBe("Trabajadores y agenda de campo");
  });

  it("REQ-515 Monster Free's three REQ-109 lines are unchanged", () => {
    expect(planById("free").features.map((f) => f.id)).toEqual([
      "unlimited-invoices",
      "five-quotes",
      "spanish-in-english-out",
    ]);
  });
});
