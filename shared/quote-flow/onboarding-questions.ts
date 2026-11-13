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
 *
 * REQ-227 (the demo's M2, decided by the orchestrator, keeping REQ-091): a
 * step's Skip saves a per-question "deferred" stamp (`user.onboardingDeferred`).
 * A deferred question is still OPEN — the next code still lands in the wizard
 * to ask it again — but the dashboard lets the person through once every open
 * question is deferred (`dashboardBlockers`); its setup checklist asks for the
 * rest. Staff (`superAdmin`) are never sent through the customer wizard.
 */
import { isPlaceholderName } from "./outbound-identity.ts";
import { hasAnyPayWay } from "../payments/pay-links.ts";

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
  user: {
    name?: string | null;
    email?: string | null;
    /** staff — never sent through the customer wizard (REQ-227) */
    superAdmin?: boolean | null;
    /** REQ-227: question → ISO time its Skip was pressed */
    onboardingDeferred?: Partial<Record<string, string>> | null;
  };
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
      return hasAnyPayWay(a.identity?.acceptedPaymentMethods); // REQ-630 AMENDMENT
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

/** REQ-227 — the questions a step's Skip may defer: all but the name, whose step has no Skip */
export const DEFERRABLE_QUESTIONS: readonly OnboardingQuestion[] = ONBOARDING_QUESTIONS.filter(
  (q) => q !== "name",
);

export function isDeferrable(q: unknown): q is OnboardingQuestion {
  return typeof q === "string" && (DEFERRABLE_QUESTIONS as readonly string[]).includes(q);
}

/** REQ-227 — a staff account (super admin): never sent through the customer wizard */
export function isStaff(a: OnboardingAnswers): boolean {
  return a.user.superAdmin === true;
}

/** REQ-227 — whether this question's Skip was pressed (an answer still beats it) */
export function isDeferred(q: OnboardingQuestion, a: OnboardingAnswers): boolean {
  return isDeferrable(q) && filled(a.user.onboardingDeferred?.[q]);
}

/**
 * REQ-227 — the questions that keep the dashboard shut: the open ones not deferred; none for
 * staff. Empty → the dashboard opens and its setup checklist asks for what is left.
 */
export function dashboardBlockers(a: OnboardingAnswers): OnboardingQuestion[] {
  if (isStaff(a)) return [];
  return unansweredQuestions(a).filter((q) => !isDeferred(q, a));
}

/**
 * REQ-504 (demo M37, cycle 3) — "Skip setup for now": the questions the escape defers in one go —
 * every open deferrable one (never the name, never an answered one). Deferred, they stop keeping
 * the dashboard shut (`dashboardBlockers`), and the setup checklist asks for them; the next code
 * still brings the wizard back (REQ-091).
 */
export function skipSetupDeferrals(a: OnboardingAnswers): OnboardingQuestion[] {
  return unansweredQuestions(a).filter((q) => isDeferrable(q));
}

/** REQ-504 — the escape is offered only once the name, which cannot be deferred, is answered */
export function canSkipSetup(a: OnboardingAnswers): boolean {
  return isAnswered("name", a);
}

/** where a verified code lands — a deferral never counts here: the wizard asks again (REQ-091) */
export function signInLanding(a: OnboardingAnswers): typeof WIZARD_PATH | typeof RETURNING_PATH {
  return isStaff(a) || onboardingAnswered(a) ? RETURNING_PATH : WIZARD_PATH;
}
