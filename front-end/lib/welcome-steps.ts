/**
 * REQ-104 — Raphael, 2026-10-20: "Monster Free signup must get initial information and then
 * skip credit card ask."
 *
 * Which of the wizard's steps an account is asked. The plan question — the three cards, and the
 * pay page behind the two paid ones — is asked only while the account has no Monster Free on
 * record: a free pick in the wizard or in settings stores it, and that person is never shown the
 * cards again. The upgrade stays where REQ-054 put it, the settings panel. REQ-120 (Raphael,
 * 2026-10-23: "on /landing2 … remove the logic that changes the onboarding, everything just ends
 * up on the plan picker onboarding page and they pick the plan there"): the /landing2 code names
 * no plan, so every new account meets the cards and picks there. Pure helpers of the wizard's
 * engine (front-end/islands/WelcomeWizard.tsx).
 */

/** the slice of the profile snapshot the rules read */
export interface PlanSnapshot {
  plan?: { status?: string | null } | null;
}

/** the plan is asked until Monster Free is on record */
export function asksPlan(snap: PlanSnapshot): boolean {
  return snap.plan?.status !== "free";
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
