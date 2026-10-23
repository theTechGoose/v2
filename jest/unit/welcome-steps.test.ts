/**
 * REQ-104 — Raphael, 2026-10-20: "Monster Free signup must get initial information and then
 * skip credit card ask."
 *
 * The wizard asks its plan question — the three cards, and the pay page behind the two paid
 * ones — only while the account has no Monster Free on record: a free pick made in the wizard
 * or in settings hides them from then on. REQ-120 (Raphael, 2026-10-23: "on /landing2 … remove
 * the logic that changes the onboarding, everything just ends up on the plan picker onboarding
 * page and they pick the plan there"): the /landing2 code names no plan any more, so every new
 * account meets the cards and picks there. The upgrade stays in settings (REQ-054).
 *
 * Target: front-end/lib/welcome-steps.ts, bound into front-end/islands/WelcomeWizard.tsx.
 */
import * as fs from "fs";
import * as path from "path";
import * as steps from "../../front-end/lib/welcome-steps";
import { askedSteps, asksPlan, indexAfterPlan } from "../../front-end/lib/welcome-steps";

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
      /import \{ askedSteps, asksPlan, indexAfterPlan \} from "\.\.\/lib\/welcome-steps\.ts";/,
    );
    expect(src).toMatch(/id: "plan",\n\s*asked: asksPlan,/);
    expect(src).toMatch(/askedSteps\(registry, snapshot\)/);
    expect(src).toMatch(/indexAfterPlan\(registry, steps\)/);
    // the old resume arithmetic — the plan step's index plus one — is gone with it
    expect(src).not.toMatch(/step\.id === "plan"\) \+ 1/);
  });
});

/**
 * REQ-120 — Raphael, 2026-10-23: "okay now on /landing2 can you please remove the logic that
 * changes the onboarding, everything just ends up on the plan picker onboarding page and they pick
 * the plan there." REQ-113's carry is gone: no button names a plan, the code stores none, and the
 * wizard's plan step is the cards for every new account — a pick made there reads as it stands
 * (plan-return's rule), the pay page behind a paid one.
 */
describe("REQ-120 nothing from /landing2 changes the wizard's plan step: it is the cards until a pick is made there", () => {
  test("REQ-120 the rules know no named plan: welcome-steps reads the plan on record alone", () => {
    expect(Object.keys(steps).filter((k) => k !== "__esModule").sort()).toEqual([
      "askedSteps",
      "asksPlan",
      "indexAfterPlan",
    ]);
    const lib = read("front-end/lib/welcome-steps.ts");
    expect(lib).not.toMatch(/signupPlan|awaitsNamedPick|planStepView|REQ-113/);
  });

  test("REQ-120 the wizard shows the cards until a pick is on record and reads a pick as it stands; the front-end carries no sign-up plan", () => {
    const src = read("front-end/islands/WelcomeWizard.tsx");
    expect(src).toMatch(
      /import \{ askedSteps, asksPlan, indexAfterPlan \} from "\.\.\/lib\/welcome-steps\.ts";/,
    );
    expect(src).toMatch(/const view = plan \? planViewOf\(plan\) : "cards";/);
    expect(src).not.toMatch(/signupPlan|awaitsNamedPick|planStepView|setReading/);
    // the words over a pick made from the cards stay: Your plan, Continue to payment
    expect(src).toMatch(/t\("welcome\.plan\.yours"\)/);
    expect(src).toMatch(/t\("plan\.continue"\)/);
    expect(read("front-end/clients/profile.ts")).not.toMatch(/signupPlan/);
    expect(read("front-end/islands/Landing2Signup.tsx")).not.toMatch(/data-plan|setPlan/);
  });
});
