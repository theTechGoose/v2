/**
 * REQ-121 — Raphael, 2026-10-23: "we should not ask the onboarding questions that we already
 * have an answer to on next login, if you login and have not completed question it should show
 * only questions that have not been answered."
 *
 * The wizard asks the questions with no answer on record when it opens — REQ-091's one definition
 * of answered — and then the closing sample-quote screen; an answered question is never shown
 * again, and the progress counts those steps alone. REQ-104 (the plan step hidden once Monster
 * Free is on record) and REQ-059 (back from a pick, resume past the plan) fold into that rule;
 * REQ-120 (every new account meets the cards) stands: nothing answered is every step.
 *
 * Target: front-end/lib/welcome-steps.ts, bound into front-end/islands/WelcomeWizard.tsx.
 */
import * as fs from "fs";
import * as path from "path";
import * as lib from "../../front-end/lib/welcome-steps";
import { indexAfterPlan, openSteps, stepCounter } from "../../front-end/lib/welcome-steps";
import {
  isAnswered,
  ONBOARDING_QUESTIONS,
  type OnboardingAnswers,
  type OnboardingQuestion,
} from "../../shared/quote-flow/onboarding-questions";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** the wizard's registry, in its order: the nine questions, each complete when answered, and the
 *  closing screen, never complete (always shown) */
const REGISTRY = [...ONBOARDING_QUESTIONS, "sampleQuote"].map((id) => ({
  id,
  isComplete: (s: OnboardingAnswers) => id === "sampleQuote" ? false : isAnswered(id as OnboardingQuestion, s),
}));
const ids = (steps: readonly { id: string }[]) => steps.map((s) => s.id);

/** a profile with exactly these questions answered, the wizard's way */
function answered(qs: OnboardingQuestion[], plan: OnboardingAnswers["plan"] = { status: "free" }): OnboardingAnswers {
  const has = (q: OnboardingQuestion) => qs.includes(q);
  return {
    user: { name: has("name") ? "Rosa Demo" : "", email: has("email") ? "rosa@roof.test" : "" },
    identity: {
      businessName: has("businessName") ? "Rosa Roofing" : "",
      logoFileId: has("logo") ? "file-1" : "",
      acceptedPaymentMethods: has("payment") ? { cash: { enabled: true } } : {},
    },
    address: { state: has("state") ? "TX" : "", street: has("address") ? "1600 Congress Ave" : "" },
    insurance: { provider: has("insurance") ? "State Farm" : "" },
    plan: has("plan") ? plan : null,
  };
}
const NOTHING = answered([]);
const EVERYTHING = answered([...ONBOARDING_QUESTIONS]);

describe("REQ-121 the wizard asks only the questions still open, and resumes past the plan over those", () => {
  test("REQ-121 the open steps are the unanswered questions in the wizard's order, then the closing screen; a pending pick is open, a free or active plan is closed", () => {
    // nothing answered: every step, the plan fourth (REQ-120)
    expect(ids(openSteps(REGISTRY, NOTHING))).toEqual(ids(REGISTRY));
    // the business name and the logo open: three steps — never the seven answered in between
    expect(ids(openSteps(REGISTRY, answered(["name", "email", "plan", "state", "address", "payment", "insurance"])))).toEqual([
      "businessName",
      "logo",
      "sampleQuote",
    ]);
    // everything answered: the closing screen alone
    expect(ids(openSteps(REGISTRY, EVERYTHING))).toEqual(["sampleQuote"]);
    // the plan (REQ-104 folded in): open with nothing picked or a paid pick still on its pay page; closed by Monster Free or an active plan
    const butPlan = ONBOARDING_QUESTIONS.filter((q) => q !== "plan");
    expect(ids(openSteps(REGISTRY, answered(butPlan)))).toEqual(["plan", "sampleQuote"]);
    expect(ids(openSteps(REGISTRY, answered([...butPlan, "plan"], { status: "pending" })))).toEqual(["plan", "sampleQuote"]);
    expect(ids(openSteps(REGISTRY, answered([...butPlan, "plan"], { status: "free" })))).toEqual(["sampleQuote"]);
    expect(ids(openSteps(REGISTRY, answered([...butPlan, "plan"], { status: "active" })))).toEqual(["sampleQuote"]);
    expect(ids(openSteps(REGISTRY, answered([...butPlan, "plan"], { status: "past_due" })))).toEqual(["sampleQuote"]);
  });

  test("REQ-121 back from a pick the wizard lands on the first open step after the plan's slot — never an earlier skipped question; the last step when none follows", () => {
    // the name skipped on the way to the plan, Monster Free picked: the state, not the name
    const skippedName = openSteps(REGISTRY, answered(["businessName", "email", "plan"]));
    expect(ids(skippedName)).toEqual(["name", "state", "address", "payment", "logo", "insurance", "sampleQuote"]);
    expect(skippedName[indexAfterPlan(REGISTRY, skippedName)].id).toBe("state");
    // the state and the address already answered: the payment methods
    const later = openSteps(REGISTRY, answered(["name", "businessName", "email", "plan", "state", "address"]));
    expect(later[indexAfterPlan(REGISTRY, later)].id).toBe("payment");
    // a paid pick still on its pay page stays open; the resume goes past it all the same (REQ-059)
    const pending = openSteps(REGISTRY, answered(["name", "businessName", "email", "plan", "state"], { status: "pending" }));
    expect(ids(pending)).toEqual(["plan", "address", "payment", "logo", "insurance", "sampleQuote"]);
    expect(pending[indexAfterPlan(REGISTRY, pending)].id).toBe("address");
    // only the closing screen left after the plan: the last step
    const done = openSteps(REGISTRY, answered([...ONBOARDING_QUESTIONS.filter((q) => q !== "name")]));
    expect(ids(done)).toEqual(["name", "sampleQuote"]);
    expect(indexAfterPlan(REGISTRY, done)).toBe(1);
    // a registry with nothing after the plan: the last open step
    const short = REGISTRY.slice(0, 4);
    expect(indexAfterPlan(short, openSteps(short, NOTHING))).toBe(3);
    expect(indexAfterPlan([], [])).toBe(0);
  });

  test("REQ-121 the wizard is bound to the rule: the open steps at mount, the first of them or the one after the plan; the asked hook and the first-incomplete search are gone", () => {
    expect(Object.keys(lib).filter((k) => k !== "__esModule").sort()).toEqual(["indexAfterPlan", "openSteps", "stepCounter"]);
    const src = read("front-end/lib/welcome-steps.ts");
    expect(src).not.toMatch(/asksPlan|askedSteps|AskedStep|signupPlan|awaitsNamedPick|planStepView/);
    const wizard = read("front-end/islands/WelcomeWizard.tsx");
    expect(wizard).toMatch(/import \{ indexAfterPlan, openSteps, stepCounter \} from "\.\.\/lib\/welcome-steps\.ts";/);
    expect(wizard).toMatch(/openSteps\(registry, snapshot\)/);
    expect(wizard).toMatch(/indexAfterPlan\(registry, steps\)\n\s*: 0\b/);
    expect(wizard).not.toMatch(/firstIncomplete|asked\?:|asked: |asksPlan|askedSteps/);
    // the plan step is answered once a plan is on record active: no visit shows "✓ plan active" any more
    expect(wizard).not.toMatch(/plan-active|welcome__plan-active/);
    // the visit's open steps drive the navigation; the counter the person reads is REQ-253's, the whole onboarding
    expect(wizard).toMatch(/const total = steps\.length;/);
  });
});

/**
 * REQ-104 — Raphael, 2026-10-20: "Monster Free signup must get initial information and then
 * skip credit card ask." Folded into REQ-121: the plan step is a question like the others, open
 * until a pick is on record; Monster Free closes it, so that person is never shown the cards, or
 * the pay page behind the paid ones, again. The upgrade stays in settings (REQ-054).
 */
describe("REQ-104 the wizard skips the plan step once the plan is Monster Free", () => {
  test("REQ-104 a Monster Free account's wizard has no plan step: name, business, email, then straight to the state", () => {
    expect(ids(openSteps(REGISTRY, answered(["plan"], { status: "free" })))).toEqual([
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
    // nothing on record, or a pick still on its pay page: the plan step is asked where it always was
    expect(ids(openSteps(REGISTRY, NOTHING))).toEqual(ids(REGISTRY));
    expect(ids(openSteps(REGISTRY, answered(["plan"], { status: "pending" })))).toEqual(ids(REGISTRY));
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
  test("REQ-120 the rules know no named plan: welcome-steps reads the answers on record alone", () => {
    const src = read("front-end/lib/welcome-steps.ts");
    expect(src).not.toMatch(/signupPlan|awaitsNamedPick|planStepView|REQ-113/);
  });

  test("REQ-120 the wizard shows the cards until a pick is on record and reads a pick as it stands; the front-end carries no sign-up plan", () => {
    const src = read("front-end/islands/WelcomeWizard.tsx");
    expect(src).toMatch(/const view = plan \? planViewOf\(plan\) : "cards";/);
    expect(src).not.toMatch(/signupPlan|awaitsNamedPick|planStepView|setReading/);
    // the words over a pick made from the cards stay: Your plan, Continue to payment
    expect(src).toMatch(/t\("welcome\.plan\.yours"\)/);
    expect(src).toMatch(/t\("plan\.continue"\)/);
    expect(read("front-end/clients/profile.ts")).not.toMatch(/signupPlan/);
    expect(read("front-end/islands/Landing2Signup.tsx")).not.toMatch(/data-plan|setPlan/);
  });
});

/**
 * REQ-253 — Raphael, 2026-11-11: "fix every issue the demo found." Demo issue
 * onboarding-dashboard-settings-p1: the counter read "Step 4 of 10" on the plan and "Step 1 of 6"
 * on the state right after it. The plan pick is a full page navigation (PlanCards' form POST →
 * 303), the wizard remounts, and REQ-121's open-steps list is recomputed shorter; the counter
 * counted "steps this visit". It now counts the whole onboarding: the total is the registry, and
 * the current step is the steps answered before this visit plus the place in it — so the reload
 * after the plan goes on to "Step 5 of 10", never back to 1.
 */
describe("REQ-253 the step counter counts the whole onboarding, so the plan pick's reload never restarts it", () => {
  const label = (open: readonly { id: string }[], index: number) => {
    const c = stepCounter(REGISTRY, open, index);
    return `Step ${c.current} of ${c.total}`;
  };

  test("REQ-253 a new account: Step 4 of 10 on the plan, then Step 5 of 10 on the state after the pick's reload (demo: Step 1 of 6)", () => {
    const first = openSteps(REGISTRY, NOTHING);
    expect(first[3].id).toBe("plan");
    expect(label(first, 0)).toBe("Step 1 of 10");
    expect(label(first, 3)).toBe("Step 4 of 10");
    // Monster Free picked: the page reloads at /welcome?after=plan with name, business, email and plan on record
    const afterPick = openSteps(REGISTRY, answered(["name", "businessName", "email", "plan"]));
    const at = indexAfterPlan(REGISTRY, afterPick);
    expect(afterPick[at].id).toBe("state");
    expect(label(afterPick, at)).toBe("Step 5 of 10");
    // and on to the closing screen, the tenth
    expect(label(afterPick, afterPick.length - 1)).toBe("Step 10 of 10");
    // a paid pick, back from its pay page with the plan active: the same
    const paid = openSteps(REGISTRY, answered(["name", "businessName", "email", "plan"], { status: "active" }));
    expect(label(paid, indexAfterPlan(REGISTRY, paid))).toBe("Step 5 of 10");
  });

  test("REQ-253 a question skipped on the way to the plan does not move the counter backwards after the reload", () => {
    // the email skipped: the plan was Step 4 of 10 all the same; after the pick the state is the fifth
    const skipped = openSteps(REGISTRY, answered(["name", "businessName", "plan"]));
    expect(label(skipped, indexAfterPlan(REGISTRY, skipped))).toBe("Step 5 of 10");
  });

  test("REQ-253 a later login keeps the same total: the two questions left and the closing screen are Step 8, 9 and 10 of 10", () => {
    const later = openSteps(REGISTRY, answered(["name", "email", "plan", "state", "address", "payment", "insurance"]));
    expect([0, 1, 2].map((i) => label(later, i))).toEqual(["Step 8 of 10", "Step 9 of 10", "Step 10 of 10"]);
    // everything answered: the closing screen is the last of ten
    expect(label(openSteps(REGISTRY, EVERYTHING), 0)).toBe("Step 10 of 10");
  });

  test("REQ-253 the wizard renders the counter, the bar and its aria values from stepCounter", () => {
    const wizard = read("front-end/islands/WelcomeWizard.tsx");
    expect(wizard).toMatch(/import \{ indexAfterPlan, openSteps, stepCounter \} from "\.\.\/lib\/welcome-steps\.ts";/);
    expect(wizard).toMatch(/stepCounter\(registry, steps, index\)/);
    // every progress number reads the counter, none the visit's own index
    expect(wizard).not.toMatch(/current: index \+ 1/);
    expect(wizard).not.toMatch(/aria-valuenow=\{index \+ 1\}/);
    expect(wizard).not.toMatch(/\(\(index \+ 1\) \/ total\)/);
  });
});
