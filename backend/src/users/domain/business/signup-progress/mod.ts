/**
 * REQ-111 — Raphael, 2026-10-21, the launch checklist: "CRITICAL — Save incomplete signups. For
 * Monster Free, Monster, and Monster Assist, save any and all information collected, even if the
 * customer does not complete signup. Capture contact information as early as possible so we can
 * call and help them finish. Include their selected plan and the exact stage they reached so the
 * team knows how to follow up. Make these incomplete signups accessible to the team."
 *
 * Pure: where an account stands, read from what it has answered — the wizard's nine questions
 * (REQ-091's one rule, shared/quote-flow/onboarding-questions.ts) — its selected plan by name, and
 * where that plan's payment stands. The words every CRM sync carries (CrmCustomerSync, REQ-111)
 * and every signup notice prints (SignupNotice, REQ-112). No I/O.
 */
import {
  isAnswered,
  ONBOARDING_QUESTIONS,
  type OnboardingAnswers,
  type OnboardingQuestion,
} from "#quote-flow/onboarding-questions.ts";
import { planOf } from "@users/domain/business/plan/mod.ts";
import type { User } from "@users/dto/user.ts";
import type { UserPlan } from "@users/dto/plan.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import type { BusinessAddress } from "@users/dto/business-address.ts";
import type { BusinessInsurance } from "@users/dto/business-insurance.ts";

/** the account as its stores hold it — what the stage, the CRM sync and the notice read */
export interface SignupSnapshot {
  user: User;
  identity: BusinessIdentity | null;
  address: BusinessAddress | null;
  insurance: BusinessInsurance | null;
  plan: UserPlan | null;
}

export type PaymentStatus = "none" | "free" | "awaiting payment" | "paid" | "past due";

export interface SignupProgress {
  /** the selected plan by name — "Monster Free", "Monster", "Monster Assist" — or "" before a pick */
  plan: string;
  payment: PaymentStatus;
  answered: number;
  total: number;
  /** the first question still open, in the wizard's order; null when none is */
  next: OnboardingQuestion | null;
  /** the stage, in words the team reads: "3 of 9 answered — next the plan · Monster picked, awaiting payment" */
  stage: string;
}

const QUESTION_WORDS: Record<OnboardingQuestion, string> = {
  name: "the name",
  businessName: "the business name",
  email: "the email",
  plan: "the plan",
  state: "the state",
  address: "the address",
  payment: "the payment methods",
  logo: "the logo",
  insurance: "the insurance",
};

/** the plan's name as the site says it; "" before a pick */
export function planLabel(plan: UserPlan | null): string {
  return plan ? planOf(plan.planId).name : "";
}

/** where the plan's payment stands */
export function paymentStatus(plan: UserPlan | null): PaymentStatus {
  if (!plan) return "none";
  switch (plan.status) {
    case "free":
      return "free";
    case "pending":
      return "awaiting payment";
    case "active":
      return "paid";
    case "past_due":
      return "past due";
  }
}

export function signupProgress(s: SignupSnapshot): SignupProgress {
  const answers: OnboardingAnswers = {
    user: s.user,
    identity: s.identity,
    address: s.address,
    insurance: s.insurance,
    plan: s.plan,
  };
  const open = ONBOARDING_QUESTIONS.filter((q) => !isAnswered(q, answers));
  const total = ONBOARDING_QUESTIONS.length;
  const answered = total - open.length;
  const next = open[0] ?? null;
  const plan = planLabel(s.plan);
  const payment = paymentStatus(s.plan);
  let stage: string;
  if (!next) stage = "onboarding complete";
  else if (s.user.onboardedAt && s.user.onboardingSkipped) {
    stage = `setup skipped — ${answered} of ${total} answered, next ${QUESTION_WORDS[next]}`;
  } else if (answered === 0) {
    stage = `signed up — nothing answered yet, next ${QUESTION_WORDS[next]}`;
  } else stage = `${answered} of ${total} answered — next ${QUESTION_WORDS[next]}`;
  if (payment === "awaiting payment") stage += ` · ${plan} picked, awaiting payment`;
  return { plan, payment, answered, total, next, stage };
}
