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
  isAnswered,
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

  test("REQ-091: the wizard's copy calls no question optional any more — the logo and the insurance are asked until answered", () => {
    for (const lang of ["en", "es"]) {
      const d = dict(lang);
      for (const key of ["welcome.logo.question", "welcome.insurance.question"]) {
        expect(d[key]).toBeTruthy();
        expect(d[key].toLowerCase()).not.toMatch(/opcional|optional/);
      }
    }
  });
});
