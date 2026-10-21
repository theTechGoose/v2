/**
 * REQ-104 — Raphael, 2026-10-20: "Monster Free signup must get initial information and then
 * skip credit card ask."
 *
 * Which of the wizard's steps an account is asked. The plan question — the three cards, and
 * the pay page behind the two paid ones — is asked only while the account has no Monster Free
 * on record: a Monster Free signup on /landing2 stores the plan with the code
 * (POST /auth/verify-otp { plan: "free" }), and a free pick in the wizard or in settings stores
 * it too; either way that person is never shown the cards again. The upgrade stays where
 * REQ-054 put it, the settings panel. Pure helpers of the wizard's engine
 * (front-end/islands/WelcomeWizard.tsx).
 */

import { type PlanView, planViewOf } from "./plan-return.ts";

/** the slice of the profile snapshot the rules read */
export interface PlanSnapshot {
  user?: { signupPlan?: string | null; email?: string | null } | null;
  plan?: { status?: string | null } | null;
}

/** the plan is asked until Monster Free is on record */
export function asksPlan(snap: PlanSnapshot): boolean {
  return snap.plan?.status !== "free";
}

// ---- REQ-113 — a paid sign-up carries its plan into the plan step -------------------------
// Raphael, 2026-10-21, the launch checklist: "Carry the selected plan from the landing-page
// button into signup so customers enter the correct flow." The $99 / $199 card's code names the
// plan on the account (ProfileUser.signupPlan); the backend makes the pick the moment the email
// is saved (PUT /me, ChoosePlan.pickNamed); the plan step reads that pick instead of showing the
// cards.

/** whether the plan step reads the pick the sign-up named before it would show the cards: a
 *  name on the account and the email a paid pick needs, nothing on record yet. Never before the
 *  email (the cards show, the paid ones waiting on it), never over a pick on record (read as it
 *  stands). */
export function awaitsNamedPick(snap: PlanSnapshot): boolean {
  return !snap.plan && Boolean(snap.user?.signupPlan) &&
    (snap.user?.email ?? "").trim().length > 0;
}

/** what the plan step shows: a pick on record as it stands (plan-return's rule — its page, the
 *  page being prepared, the cards again after a refusal, active); nothing on record is the page
 *  being prepared while the named pick is read, the cards otherwise */
export function planStepView(
  plan: Parameters<typeof planViewOf>[0],
  reading: boolean,
): PlanView {
  if (plan) return planViewOf(plan);
  return reading ? "preparing" : "cards";
}

/** a registry step: `asked` says whether this account is asked it; absent = always */
export interface AskedStep<S> {
  id: string;
  asked?: (snap: S) => boolean;
}

/** the steps this account is asked, in the registry's order */
export function askedSteps<S, T extends AskedStep<S>>(
  registry: readonly T[],
  snap: S,
): T[] {
  return registry.filter((step) => step.asked?.(snap) ?? true);
}

/**
 * REQ-059 — after a pick the wizard resumes PAST the plan: the index, among the asked steps, of
 * the step that follows the plan's slot in the registry — the same step whether the plan step is
 * asked or not (REQ-104); the last step when nothing follows
 */
export function indexAfterPlan<T extends { id: string }>(
  registry: readonly T[],
  asked: readonly T[],
): number {
  const next = registry[registry.findIndex((step) => step.id === "plan") + 1]
    ?.id;
  const i = asked.findIndex((step) => step.id === next);
  return i === -1 ? Math.max(0, asked.length - 1) : i;
}
