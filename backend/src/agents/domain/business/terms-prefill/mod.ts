import type { WizardStep } from "@agents/dto/wizard.ts";
import { TERMS_WIZARD_V1 } from "@agents/domain/business/terms-wizard-spec/mod.ts";

/**
 * REQ-258 (demo M22) — terms the contractor already stated in the chat
 * ("half deposit") travel from create_quote to the terms wizard, keyed by
 * wizard step id → option id (e.g. `{ payment_terms: "50_50" }`). The wizard
 * then offers that option pre-selected; the contractor still confirms it.
 */
export type TermsPrefill = Record<string, string>;

/** The payment_terms options a chat message can name — every preset of the
 *  wizard's payment step (the free-text "custom" option excluded). Derived
 *  from the spec so the tool schema can never drift from the wizard. */
export const PAYMENT_TERMS_PRESETS: readonly string[] = TERMS_WIZARD_V1.steps
  .find((s) => s.id === "payment_terms")!
  .options.filter((o) => !o.isCustom)
  .map((o) => o.id);

/** The option of `step` to show pre-selected, if the prefill names one of
 *  its preset (non-custom) options. */
export function suggestedOptionId(
  prefill: TermsPrefill | undefined,
  step: WizardStep | undefined,
): string | undefined {
  if (!prefill || !step) return undefined;
  const id = prefill[step.id];
  if (!id) return undefined;
  return step.options.some((o) => o.id === id && !o.isCustom) ? id : undefined;
}
