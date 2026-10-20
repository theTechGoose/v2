/**
 * REQ-091 — Raphael, 2026-10-18: "onboarding must happen until we get answers
 * to all the questions."
 *
 * The one definition of "onboarding answered", shared by:
 *   - the backend, deciding where a verified code lands (every verify: phone,
 *     email, account recovery) — the wizard while a question is open, the
 *     dashboard as a returning user once none is;
 *   - the welcome page, which lets an account go only when nothing is open;
 *   - the dashboard's gate, which sends an account with an open question
 *     back to the wizard.
 *
 * A question is answered by the profile field the wizard saves it to. The
 * seeded placeholder name is not a name; a pick still waiting on its pay page
 * is not a plan; a payment-method map with nothing switched on is not an
 * answer; and the skip stamp (`onboardedAt`) is not an answer to anything —
 * Skip puts a question off, the wizard asks it again next time.
 */
import { isPlaceholderName } from "./outbound-identity.ts";

/** the wizard's questions, in its order (front-end/islands/WelcomeWizard.tsx) */
export const ONBOARDING_QUESTIONS = [
  "name",
  "businessName",
  "email",
  "plan",
  "state",
  "address",
  "payment",
  "logo",
  "insurance",
] as const;
export type OnboardingQuestion = (typeof ONBOARDING_QUESTIONS)[number];

/** the slice of a profile snapshot the questions read — the backend's and the front-end's both fit */
export interface OnboardingAnswers {
  user: { name?: string | null; email?: string | null };
  identity?: {
    businessName?: string | null;
    logoFileId?: string | null;
    /** any shape — the backend's class, the front-end's interface; read as a map of { enabled } */
    acceptedPaymentMethods?: object | null;
  } | null;
  address?: { state?: string | null; street?: string | null } | null;
  insurance?: { provider?: string | null } | null;
  plan?: { status?: string | null } | null;
}

export const WIZARD_PATH = "/welcome";
export const RETURNING_PATH = "/dashboard?welcome=back";

const filled = (s: string | null | undefined): boolean => (s ?? "").trim().length > 0;

export function isAnswered(q: OnboardingQuestion, a: OnboardingAnswers): boolean {
  switch (q) {
    case "name":
      return !isPlaceholderName(a.user.name);
    case "businessName":
      return filled(a.identity?.businessName);
    case "email":
      return filled(a.user.email);
    case "plan":
      return Boolean(a.plan) && a.plan?.status !== "pending";
    case "state":
      return filled(a.address?.state);
    case "address":
      return filled(a.address?.street);
    case "payment":
      return Object.values(
        (a.identity?.acceptedPaymentMethods ?? {}) as Record<string, { enabled?: boolean } | null | undefined>,
      ).some((m) => Boolean(m?.enabled));
    case "logo":
      return filled(a.identity?.logoFileId);
    case "insurance":
      return filled(a.insurance?.provider);
  }
}

/** the questions still open, in the wizard's order */
export function unansweredQuestions(a: OnboardingAnswers): OnboardingQuestion[] {
  return ONBOARDING_QUESTIONS.filter((q) => !isAnswered(q, a));
}

export function onboardingAnswered(a: OnboardingAnswers): boolean {
  return unansweredQuestions(a).length === 0;
}

/** where a verified code lands */
export function signInLanding(a: OnboardingAnswers): typeof WIZARD_PATH | typeof RETURNING_PATH {
  return onboardingAnswered(a) ? RETURNING_PATH : WIZARD_PATH;
}
