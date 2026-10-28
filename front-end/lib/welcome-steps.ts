/**
 * REQ-121 — Raphael, 2026-10-23: "we should not ask the onboarding questions that we already
 * have an answer to on next login, if you login and have not completed question it should show
 * only questions that have not been answered."
 *
 * Which of the wizard's steps a visit asks: the ones with no answer on record when the wizard
 * opens — REQ-091's one definition of answered, read by each step's `isComplete` — in the
 * registry's order, and the closing screen, which is never complete. A question answered on an
 * earlier visit is never shown again; the list is fixed at mount, so answering a step on this
 * visit does not pull it out from under the person. REQ-104's rule (the plan step hidden once
 * Monster Free is on record) is this rule: a plan on record — free, or a paid one active — is
 * answered; nothing picked, or a paid pick still on its pay page, keeps the step open. REQ-120:
 * a new account has nothing answered, so it meets every step. Pure helpers of the wizard's
 * engine (front-end/islands/WelcomeWizard.tsx).
 */

/** a registry step: `isComplete` says whether the account has answered it */
export interface OpenStep<S> {
  id: string;
  isComplete: (snap: S) => boolean;
}

/** the steps this visit asks: the ones not answered when the wizard opens, in the registry's order */
export function openSteps<S, T extends OpenStep<S>>(
  registry: readonly T[],
  snap: S,
): T[] {
  return registry.filter((step) => !step.isComplete(snap));
}

/**
 * REQ-059 — after a pick the wizard resumes PAST the plan: the index, among the open steps, of
 * the first one that follows the plan's slot in the registry — never an earlier question the
 * person skipped on the way to the plan; the last open step when nothing follows
 */
export function indexAfterPlan<T extends { id: string }>(
  registry: readonly T[],
  open: readonly T[],
): number {
  const planAt = registry.findIndex((step) => step.id === "plan");
  const i = open.findIndex((step) => registry.findIndex((r) => r.id === step.id) > planAt);
  return i === -1 ? Math.max(0, open.length - 1) : i;
}
