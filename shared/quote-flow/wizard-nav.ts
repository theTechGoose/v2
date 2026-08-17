/**
 * Wizard back-navigation (raw-plan p2, p3, p8): every step after the first
 * can go back with all answers preserved (steps stay editable); at the first
 * step — or at the terminal invoice stage, where the flow is done — back
 * exits to the dashboard instead.
 */

export interface WizardState {
  steps: readonly string[];
  stepIndex: number;
  answers: Record<string, unknown>;
}

export type BackTarget = "previous-step" | "dashboard";

export function canGoBack(state: WizardState): boolean {
  return state.stepIndex > 0;
}

/** One step backwards; answers are preserved so earlier steps stay editable. */
export function goBack(state: WizardState): WizardState {
  return {
    ...state,
    stepIndex: Math.max(0, state.stepIndex - 1),
    answers: state.answers,
  };
}

export function backTarget(state: WizardState): BackTarget {
  const terminal = state.stepIndex >= state.steps.length - 1;
  if (terminal || state.stepIndex === 0) return "dashboard";
  return "previous-step";
}
