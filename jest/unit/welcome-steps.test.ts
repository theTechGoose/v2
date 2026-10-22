/**
 * REQ-104 — Raphael, 2026-10-20: "Monster Free signup must get initial information and then
 * skip credit card ask."
 *
 * The wizard asks its plan question — the three cards, and the pay page behind the two paid
 * ones — only while the account has no Monster Free on record. A Monster Free signup on
 * /landing2 stores the plan with the code (POST /auth/verify-otp { plan: "free" }), so that
 * wizard goes name → business → email → state and never shows the cards; a free pick made in
 * the wizard or in settings hides them the same way. The upgrade stays in settings (REQ-054).
 *
 * Target: front-end/lib/welcome-steps.ts, bound into front-end/islands/WelcomeWizard.tsx.
 */
import * as fs from "fs";
import * as path from "path";
import {
  askedSteps,
  asksPlan,
  awaitsNamedPick,
  indexAfterPlan,
  planStepView,
} from "../../front-end/lib/welcome-steps";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** the wizard's registry, in its order; only the plan step says when it is asked */
const REGISTRY = [
  "name",
  "businessName",
  "email",
  "plan",
  "state",
  "address",
  "payment",
  "logo",
  "insurance",
  "sampleQuote",
].map((id) => ({ id, asked: id === "plan" ? asksPlan : undefined }));
const ids = (steps: readonly { id: string }[]) => steps.map((s) => s.id);

describe("REQ-104 the wizard skips the plan step once the plan is Monster Free", () => {
  test("REQ-104 the plan is asked until Monster Free is on record", () => {
    expect(asksPlan({})).toBe(true);
    expect(asksPlan({ plan: null })).toBe(true);
    expect(asksPlan({ plan: { status: "pending" } })).toBe(true);
    expect(asksPlan({ plan: { status: "active" } })).toBe(true);
    expect(asksPlan({ plan: { status: "past_due" } })).toBe(true);
    expect(asksPlan({ plan: { status: "free" } })).toBe(false);
  });

  test("REQ-104 a Monster Free account's wizard has no plan step: name, business, email, then straight to the state", () => {
    expect(ids(askedSteps(REGISTRY, { plan: { status: "free" } }))).toEqual([
      "name",
      "businessName",
      "email",
      "state",
      "address",
      "payment",
      "logo",
      "insurance",
      "sampleQuote",
    ]);
    // nothing on record, or a paid plan: the plan step is asked where it always was
    expect(ids(askedSteps(REGISTRY, {}))).toEqual(ids(REGISTRY));
    expect(ids(askedSteps(REGISTRY, { plan: { status: "pending" } }))).toEqual(
      ids(REGISTRY),
    );
  });

  test("REQ-104 after a pick the wizard resumes at the step after the plan's slot, whether the plan step is shown or not", () => {
    const shown = askedSteps(REGISTRY, {});
    expect(indexAfterPlan(REGISTRY, shown)).toBe(4);
    expect(shown[indexAfterPlan(REGISTRY, shown)].id).toBe("state");
    const hidden = askedSteps(REGISTRY, { plan: { status: "free" } });
    expect(indexAfterPlan(REGISTRY, hidden)).toBe(3);
    expect(hidden[indexAfterPlan(REGISTRY, hidden)].id).toBe("state");
    // a registry without a step after the plan: the last step
    const short = REGISTRY.slice(0, 4);
    expect(indexAfterPlan(short, askedSteps(short, {}))).toBe(3);
  });

  test("REQ-104 the wizard is bound to the rule: the plan step says when it is asked, the engine shows the asked steps and resumes by the registry", () => {
    const src = read("front-end/islands/WelcomeWizard.tsx");
    expect(src).toMatch(
      /import \{ askedSteps, asksPlan, awaitsNamedPick, indexAfterPlan, planStepView \} from "\.\.\/lib\/welcome-steps\.ts";/,
    );
    expect(src).toMatch(/id: "plan",\n\s*asked: asksPlan,/);
    expect(src).toMatch(/askedSteps\(registry, snapshot\)/);
    expect(src).toMatch(/indexAfterPlan\(registry, steps\)/);
    // the old resume arithmetic — the plan step's index plus one — is gone with it
    expect(src).not.toMatch(/step\.id === "plan"\) \+ 1/);
  });
});

/**
 * REQ-113 — Raphael, 2026-10-21, the launch checklist: "Carry the selected plan from the
 * landing-page button into signup so customers enter the correct flow." — and, told the $99 pick
 * was asked again at the wizard's fourth step: "can we get #2 implemented?" The $99 / $199 card's
 * code names the plan on the account; the backend makes the pick the moment the email lands
 * (PUT /me); the plan step reads that pick instead of showing the cards.
 */
describe("REQ-113 a paid sign-up carries its plan into the wizard's plan step", () => {
  const user = (signupPlan?: "monster" | "assist" | "assist-plus", email?: string) => ({ signupPlan, email });

  test("REQ-113 the plan step reads the pick the sign-up named once the email is on the account — never before the email, never over a pick on record, never without a name", () => {
    expect(awaitsNamedPick({ user: user("monster", "a@b.test"), plan: null })).toBe(true);
    expect(awaitsNamedPick({ user: user("assist", "a@b.test") })).toBe(true);
    expect(awaitsNamedPick({ user: user("assist-plus", "a@b.test") })).toBe(true); // REQ-118
    expect(awaitsNamedPick({ user: user("monster"), plan: null })).toBe(false);
    expect(awaitsNamedPick({ user: user("monster", "  "), plan: null })).toBe(false);
    expect(awaitsNamedPick({ user: user(undefined, "a@b.test"), plan: null })).toBe(false);
    expect(awaitsNamedPick({ user: user("monster", "a@b.test"), plan: { status: "pending" } })).toBe(false);
    expect(awaitsNamedPick({ user: user("monster", "a@b.test"), plan: { status: "free" } })).toBe(false);
  });

  test("REQ-113 while the named pick is being read the step is the page being prepared, never the cards; a pick on record reads as it stands", () => {
    expect(planStepView(null, true)).toBe("preparing");
    expect(planStepView(undefined, true)).toBe("preparing");
    expect(planStepView(null, false)).toBe("cards");
    expect(planStepView({ status: "pending" }, false)).toBe("preparing");
    expect(planStepView({ status: "pending", payUrl: "https://pay.test/x" }, false)).toBe("pay");
    expect(planStepView({ status: "pending", payUrl: "https://pay.test/x" }, true)).toBe("pay");
    expect(planStepView({ status: "pending", payLinkError: "merchant-unknown" }, true)).toBe("cards");
    expect(planStepView({ status: "active" }, true)).toBe("active");
  });

  test("REQ-113 the wizard is bound to the rule, and its plan step says Your plan over a pick in flight and Continue to payment on the way to the page, in both languages", () => {
    const src = read("front-end/islands/WelcomeWizard.tsx");
    expect(src).toMatch(
      /import \{ askedSteps, asksPlan, awaitsNamedPick, indexAfterPlan, planStepView \} from "\.\.\/lib\/welcome-steps\.ts";/,
    );
    expect(src).toMatch(/awaitsNamedPick\(ctx\.snap\)/);
    expect(src).toMatch(/planStepView\(/);
    expect(src).toMatch(/t\("plan\.continue"\)/);
    expect(src).not.toMatch(/t\("plan\.resume"\)/);
    expect(src).toMatch(/t\("welcome\.plan\.yours"\)/);
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(en["welcome.plan.yours"]).toBe("Your plan");
    expect(en["plan.continue"]).toBe("Continue to payment");
    expect(en["welcome.plan.yoursWhy"]).toMatch(/Settings/);
    expect(es["welcome.plan.yours"]).toBe("Tu plan");
    expect(es["plan.continue"]).toBe("Continuar al pago");
    expect(es["welcome.plan.yoursWhy"]).toMatch(/Configuración/);
  });
});
