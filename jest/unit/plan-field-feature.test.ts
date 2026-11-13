/**
 * REQ-515 — demo-loop cycle 3, issue m53: "Plan cards say nothing about workers or field".
 * Pair 8 at onboarding step 4: "Free / Monster $99 / Assist $199 list only quotes, invoices and
 * e-signatures, so as a crew owner I can't tell which plan includes worker logins."
 *
 * Field (workers, the field schedule) is not plan-gated. Since REQ-733 (cycle 5) the line is
 * Monster Free's, and the paid plans inherit it through "Everything in …"; the wizard and settings
 * cards (front-end/components/PlanCards.tsx) show a plan's whole list, and the landing pages
 * project it (front-end/lib/landing-dict.ts).
 * Target: shared/quote-flow/pricing-plans.ts
 */
import { LANDING_DICT } from "../../front-end/lib/landing-dict";
import {
  planById,
  planFeatures,
  PUBLIC_PLANS,
} from "../../shared/quote-flow/pricing-plans";

const FIELD_ID = "workers-field-schedule";
const FIELD_EN = "Workers & field schedule";
const FIELD_ES = "Trabajadores y agenda de campo";

/*
 * REQ-733 (demo m17 + c1-m42, cycle 5) supersedes REQ-515's placement and REQ-607's wording: the
 * line is Monster Free's — field is on every plan, and Free's card now says what Free has — so
 * Monster, Assist and Assist+ carry it through the "Everything in" chain, and the plan cards show a
 * plan's whole list (front-end/lib/plan-cards-all-features.test.tsx), not its first three.
 */
describe("REQ-515 (demo m53, cycle 3) — the plan cards say which plan includes workers & the field schedule", () => {
  it("REQ-515 / REQ-733 Monster Free carries the workers & field schedule line in en and es", () => {
    const line = planById("free").features.find((f) => f.id === FIELD_ID);
    expect(line).toBeDefined();
    expect(line!.en).toBe(FIELD_EN);
    expect(line!.es).toBe(FIELD_ES);
    expect(planFeatures("free", "en")).toContain(FIELD_EN);
    expect(planFeatures("free", "es")).toContain(FIELD_ES);
  });

  it("REQ-515 Monster, Monster Assist and Monster Assist+ inherit it through the 'Everything in' chain", () => {
    expect(planById("monster").features[0].id).toBe("everything-in-free");
    expect(planById("assist").features[0].id).toBe("everything-in-monster");
    expect(planById("assist-plus").features[0].id).toBe("everything-in-assist");
  });

  it("REQ-515 the landing pages project the same line onto the Free tier, both languages", () => {
    const tier = PUBLIC_PLANS.findIndex((p) => p.id === "free") + 1;
    const n = planById("free").features.findIndex((f) => f.id === FIELD_ID) + 1;
    expect(n).toBeGreaterThan(0);
    expect(LANDING_DICT.en[`price.t${tier}.f${n}`]).toBe(FIELD_EN);
    expect(LANDING_DICT.es[`price.t${tier}.f${n}`]).toBe(FIELD_ES);
  });

  it("REQ-515 / REQ-109 Monster Free's three dictated lines still lead its list", () => {
    expect(planById("free").features.slice(0, 3).map((f) => f.id)).toEqual([
      "unlimited-invoices",
      "five-quotes",
      "spanish-in-english-out",
    ]);
  });
});

/**
 * REQ-607 — demo-loop cycle 4, issue m27: "Worker features open on Free plan". Field is not
 * plan-gated, so the pricing copy must not imply it is a paid feature. REQ-733 (cycle 5) keeps
 * that rule and drops REQ-607's "on every plan, Free included" wording on Monster's card: the line
 * now sits on Free itself.
 */
describe("REQ-607 (demo m27, cycle 4) — the pricing copy does not imply field is a paid feature", () => {
  it("REQ-607 / REQ-733 no paid plan lists field as its own line", () => {
    for (const p of PUBLIC_PLANS.filter((p) => p.id !== "free")) {
      for (const f of p.features) {
        expect(f.en).not.toMatch(/field schedule/i);
        expect(f.es).not.toMatch(/agenda de campo/i);
      }
    }
  });
});
