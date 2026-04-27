import type { WizardSpec, WizardState, WizardStep } from "@agents/dto/wizard.ts";

export interface WizardProgress {
  /** The step the user is currently being asked. `null` once the wizard is complete. */
  activeStep: WizardStep | null;
  /** Steps the user has already answered, in spec order. */
  completedSteps: WizardStep[];
  /** Steps still to come after the active one. Empty when on the last step. */
  remainingSteps: WizardStep[];
  /** True once every step has been answered. */
  isComplete: boolean;
  /** 0..1 — completed / total. */
  fractionDone: number;
}

/**
 * Pure projection from (spec, state) to a renderable progress view.
 *
 * Doesn't consult storage. The state's `activeStepIdx` is the source of
 * truth for "which step are we on now" — the answers list is treated as
 * additive history, not the cursor.
 */
export function computeProgress(spec: WizardSpec, state: WizardState): WizardProgress {
  const total = spec.steps.length;
  const idx = Math.max(0, Math.min(state.activeStepIdx, total));
  const completedSteps = spec.steps.slice(0, idx);
  const activeStep = idx < total ? spec.steps[idx] : null;
  const remainingSteps = idx < total - 1 ? spec.steps.slice(idx + 1) : [];
  const isComplete = idx >= total;
  const fractionDone = total === 0 ? 1 : (isComplete ? 1 : completedSteps.length / total);
  return { activeStep, completedSteps, remainingSteps, isComplete, fractionDone };
}

/**
 * Apply a single answer to the current state and return the next state.
 *
 * Throws if the answered stepId doesn't match the active step (out-of-order
 * answers aren't supported — the wizard advances strictly forward).
 *
 * If the user re-answers a previously-completed step (re-edit flow), they
 * jump back to that step first via a separate "rewind" coordinator; this
 * function only handles forward advancement.
 */
export function applyAnswer(
  spec: WizardSpec,
  state: WizardState,
  input: { stepId: string; optionId: string; customValue?: string },
): WizardState {
  const idx = state.activeStepIdx;
  const active = spec.steps[idx];
  if (!active) throw new Error(`wizard already complete (step ${idx} of ${spec.steps.length})`);
  if (active.id !== input.stepId) {
    throw new Error(`expected answer for "${active.id}", got "${input.stepId}"`);
  }
  const option = active.options.find((o) => o.id === input.optionId);
  if (!option) throw new Error(`unknown option "${input.optionId}" for step "${active.id}"`);
  if (option.isCustom && (input.customValue ?? "").trim() === "") {
    throw new Error(`option "${input.optionId}" requires a customValue`);
  }
  const next: WizardState = {
    specId: state.specId,
    activeStepIdx: idx + 1,
    answers: [
      ...state.answers,
      {
        stepId: input.stepId,
        optionId: input.optionId,
        customValue: option.isCustom ? input.customValue : undefined,
        answeredAt: new Date().toISOString(),
      },
    ],
  };
  return next;
}

/** Convenience: brand-new state ready for step 0. */
export function freshState(spec: WizardSpec): WizardState {
  return { specId: spec.id, activeStepIdx: 0, answers: [] };
}
