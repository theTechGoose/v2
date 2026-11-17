/**
 * REQ-091 — Raphael, 2026-10-18, after a team phone's first sign-in was eaten
 * by the broken-origin window and the next code landed on the dashboard:
 * "onboarding must happen until we get answers to all the questions."
 *
 * The one definition of "answered", shared by the backend (where a code
 * lands), the welcome page (when it lets go) and the dashboard (when it sends
 * the person back): the wizard's nine questions, each answered by the profile
 * field the wizard saves it to — never a one-shot "new user" flag, never the
 * skip stamp.
 */
import * as fs from "fs";
import * as path from "path";
import {
  DEFERRABLE_QUESTIONS,
  dashboardBlockers,
  isAnswered,
  isStaff,
  ONBOARDING_QUESTIONS,
  onboardingAnswered,
  RETURNING_PATH,
  signInLanding,
  unansweredQuestions,
  WIZARD_PATH,
  type OnboardingAnswers,
} from "../../shared/quote-flow/onboarding-questions";

const ROOT = path.resolve(__dirname, "../..");
const dict = (lang: string) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, `lang/${lang}.json`), "utf8")) as Record<string, string>;

const FRESH: OnboardingAnswers = {
  user: { name: "New user" },
  identity: null,
  address: null,
  insurance: null,
  plan: null,
};

const ALL: OnboardingAnswers = {
  user: { name: "Story Person", email: "story@example.com" },
  identity: {
    businessName: "Story Roofing LLC",
    logoFileId: "f-logo",
    acceptedPaymentMethods: { cash: { enabled: true }, zelle: { enabled: false } },
  },
  address: { state: "TX", street: "1600 Congress Ave" },
  insurance: { provider: "State Farm" },
  plan: { status: "free" },
};

describe("REQ-091: onboarding happens until every question is answered", () => {
  test("REQ-091: the wizard's nine questions, in its order", () => {
    expect([...ONBOARDING_QUESTIONS]).toEqual([
      "name", "businessName", "email", "plan", "state", "address", "payment", "logo", "insurance",
    ]);
  });

  test("REQ-091: a fresh account has answered nothing — the seeded placeholder is not a name", () => {
    expect(unansweredQuestions(FRESH)).toEqual([...ONBOARDING_QUESTIONS]);
    expect(onboardingAnswered(FRESH)).toBe(false);
    for (const name of ["New user", "Nuevo usuario", "", "   ", undefined]) {
      expect(isAnswered("name", { ...FRESH, user: { name } })).toBe(false);
    }
    expect(isAnswered("name", { ...FRESH, user: { name: "Story Person" } })).toBe(true);
  });

  test("REQ-091: every question is answered by the field the wizard saves it to", () => {
    expect(unansweredQuestions(ALL)).toEqual([]);
    expect(onboardingAnswered(ALL)).toBe(true);
    // blank or whitespace is not an answer
    expect(isAnswered("businessName", { ...ALL, identity: { ...ALL.identity, businessName: "  " } })).toBe(false);
    expect(isAnswered("email", { ...ALL, user: { ...ALL.user, email: "" } })).toBe(false);
    expect(isAnswered("state", { ...ALL, address: { street: "x", state: "" } })).toBe(false);
    expect(isAnswered("address", { ...ALL, address: { state: "TX", street: " " } })).toBe(false);
    expect(isAnswered("insurance", { ...ALL, insurance: { provider: "" } })).toBe(false);
    expect(isAnswered("logo", { ...ALL, identity: { ...ALL.identity, logoFileId: "" } })).toBe(false);
    // a payment method map with nothing switched on is not an answer
    expect(isAnswered("payment", { ...ALL, identity: { ...ALL.identity, acceptedPaymentMethods: { cash: { enabled: false } } } })).toBe(false);
    expect(isAnswered("payment", { ...ALL, identity: { ...ALL.identity, acceptedPaymentMethods: {} } })).toBe(false);
    // the plan: picked and settled — free, active or past due; a pick still waiting on its pay page is open
    expect(isAnswered("plan", { ...ALL, plan: null })).toBe(false);
    expect(isAnswered("plan", { ...ALL, plan: undefined })).toBe(false);
    expect(isAnswered("plan", { ...ALL, plan: { status: "pending" } })).toBe(false);
    for (const status of ["free", "active", "past_due"]) {
      expect(isAnswered("plan", { ...ALL, plan: { status } })).toBe(true);
    }
  });

  test("REQ-091: one open question is enough to land the code in the wizard; all nine answered lands it on the dashboard", () => {
    expect(signInLanding(ALL)).toBe(RETURNING_PATH);
    expect(RETURNING_PATH).toBe("/dashboard?welcome=back");
    expect(WIZARD_PATH).toBe("/welcome");
    const withoutOne: Record<string, OnboardingAnswers> = {
      name: { ...ALL, user: { ...ALL.user, name: "New user" } },
      businessName: { ...ALL, identity: { ...ALL.identity, businessName: undefined } },
      email: { ...ALL, user: { ...ALL.user, email: undefined } },
      plan: { ...ALL, plan: { status: "pending" } },
      state: { ...ALL, address: { ...ALL.address, state: undefined } },
      address: { ...ALL, address: { ...ALL.address, street: undefined } },
      payment: { ...ALL, identity: { ...ALL.identity, acceptedPaymentMethods: undefined } },
      logo: { ...ALL, identity: { ...ALL.identity, logoFileId: undefined } },
      insurance: { ...ALL, insurance: null },
    };
    for (const q of ONBOARDING_QUESTIONS) {
      expect(unansweredQuestions(withoutOne[q])).toEqual([q]);
      expect(signInLanding(withoutOne[q])).toBe(WIZARD_PATH);
    }
  });

  test("REQ-091 + REQ-227: the wizard's copy calls no question optional any more — the logo and the insurance are asked until answered, in the question AND its *.why line", () => {
    for (const lang of ["en", "es"]) {
      const d = dict(lang);
      for (const key of [
        "welcome.logo.question", "welcome.insurance.question",
        "welcome.logo.why", "welcome.insurance.why",
      ]) {
        expect(d[key]).toBeTruthy();
        expect(d[key].toLowerCase()).not.toMatch(/opcional|optional/);
      }
      // every step's *.why line, not just the two above
      for (const [key, value] of Object.entries(d)) {
        if (/^welcome\.[a-zA-Z]+\.why$/.test(key)) {
          expect(`${key}: ${value.toLowerCase()}`).not.toMatch(/opcional|optional/);
        }
      }
    }
  });
});

/**
 * REQ-227 — the demo (M2, test-setup-claims-nc-dashboard, demo-lifecycle-p2): /dashboard always
 * bounced to /welcome ("Add your logo") because a step's Skip saved nothing, and staff went
 * through the customer wizard. Decision (orchestrator, keeping REQ-091): a step's Skip saves a
 * per-question "deferred" stamp; the dashboard lets the person through when every open question
 * is deferred; the sign-in landing still re-asks. Staff are never sent through the wizard.
 */
describe("REQ-227: a skipped question is deferred — the dashboard lets it through, the next code asks again", () => {
  const deferred = (qs: string[]): OnboardingAnswers["user"]["onboardingDeferred"] =>
    Object.fromEntries(qs.map((q) => [q, "2026-11-11T00:00:00.000Z"]));
  const noLogo: OnboardingAnswers = { ...ALL, identity: { ...ALL.identity, logoFileId: undefined } };
  const noLogoNoInsurance: OnboardingAnswers = { ...noLogo, insurance: null };

  test("REQ-227: every question but the name can be deferred (the wizard's name step has no Skip)", () => {
    expect([...DEFERRABLE_QUESTIONS]).toEqual(ONBOARDING_QUESTIONS.filter((q) => q !== "name"));
  });

  test("REQ-227: an open question not deferred blocks the dashboard; deferred, it does not", () => {
    expect(dashboardBlockers(ALL)).toEqual([]);
    expect(dashboardBlockers(noLogo)).toEqual(["logo"]);
    expect(dashboardBlockers({ ...noLogo, user: { ...noLogo.user, onboardingDeferred: deferred(["logo"]) } })).toEqual([]);
    // one of two deferred: the other still blocks
    expect(dashboardBlockers({ ...noLogoNoInsurance, user: { ...ALL.user, onboardingDeferred: deferred(["logo"]) } }))
      .toEqual(["insurance"]);
    expect(dashboardBlockers({ ...noLogoNoInsurance, user: { ...ALL.user, onboardingDeferred: deferred(["logo", "insurance"]) } }))
      .toEqual([]);
    // the placeholder name can never be deferred past
    const noName: OnboardingAnswers = { ...ALL, user: { name: "New user", email: ALL.user.email, onboardingDeferred: deferred(["name"]) } };
    expect(dashboardBlockers(noName)).toEqual(["name"]);
    // the leave stamp (onboardedAt) is still not an answer nor a deferral
    expect(dashboardBlockers({ ...noLogo, user: { ...noLogo.user, onboardedAt: "2026-11-11T00:00:00.000Z" } as OnboardingAnswers["user"] }))
      .toEqual(["logo"]);
  });

  test("REQ-227: a deferred question is still open — the next code lands in the wizard to ask it again", () => {
    const later = { ...noLogo, user: { ...noLogo.user, onboardingDeferred: deferred(["logo"]) } };
    expect(unansweredQuestions(later)).toEqual(["logo"]);
    expect(onboardingAnswered(later)).toBe(false);
    expect(signInLanding(later)).toBe(WIZARD_PATH);
  });

  test("REQ-227 (demo-lifecycle-p2): staff are never sent through the customer wizard — no dashboard blockers, the code lands on the dashboard", () => {
    const staff: OnboardingAnswers = { ...FRESH, user: { name: "New user", superAdmin: true } };
    expect(isStaff(staff)).toBe(true);
    expect(isStaff(FRESH)).toBe(false);
    expect(dashboardBlockers(staff)).toEqual([]);
    expect(signInLanding(staff)).toBe(RETURNING_PATH);
    // a customer is unchanged
    expect(signInLanding(FRESH)).toBe(WIZARD_PATH);
  });
});

describe("REQ-227: the pages read the one rule", () => {
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  test("REQ-227: the dashboard's gate asks dashboardBlockers, not the raw open questions", () => {
    const gate = read("front-end/lib/onboarding-gate.ts");
    expect(gate).toMatch(/dashboardBlockers\(/);
    const mw = read("front-end/routes/dashboard/_middleware.ts");
    expect(mw).toMatch(/dashboardGateQuestions\(/);
    expect(mw).not.toMatch(/openOnboardingQuestions\(/);
  });

  test("REQ-227: /welcome lets staff go to the dashboard, like a finished account", () => {
    const welcome = read("front-end/routes/welcome.tsx");
    expect(welcome).toMatch(/isStaff\(snapshot\)/);
  });

  test("REQ-227: a step's Skip saves the deferral (POST /api/me/onboarding/deferred) before it moves on", () => {
    const wizard = read("front-end/islands/WelcomeWizard.tsx");
    expect(wizard).toMatch(/\/api\/me\/onboarding\/deferred/);
    const footer = wizard.slice(wizard.indexOf('data-cy="welcome-skip"'), wizard.indexOf('data-cy="welcome-skip"') + 200);
    expect(footer).toMatch(/onClick=\{ctx\.skip\}/);
  });

  test("REQ-227 (demo-lifecycle-p2): the admin's own row on /admin has no Demo and no Impersonate", () => {
    const admin = read("front-end/islands/AdminPage.tsx");
    expect(admin).toMatch(/selfId/);
    expect(admin).toMatch(/u\.id !== selfId/);
    const route = read("front-end/routes/admin/index.tsx");
    expect(route).toMatch(/<AdminPage selfId=\{user\?\.id\}/);
  });
});
