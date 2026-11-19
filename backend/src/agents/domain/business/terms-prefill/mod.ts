import type { WizardStep } from "@agents/dto/wizard.ts";
import { extractPaymentTerms } from "#quote-flow/quote-facts.ts";
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

/**
 * REQ-1105 (LOOP-007 cycle 3, q3-29; cites REQ-258 / REQ-936) — the payment
 * preset to store for the model's create_quote `paymentTerms`, checked
 * against the deterministic parse of what the contractor typed. "30% deposit"
 * parses as a deposit then the balance, so it is 'deposit_bal' even when the
 * model answered '30_30_40'; a typed preset ("30/30/40", "half down") wins
 * the same way. When the words name no preset or deposit (a custom schedule,
 * a recurring price, or nothing — a correction that doesn't restate it) the
 * model's value stands.
 */
export function reconcilePaymentTerms(
  modelTerms: string,
  typed: string,
): string {
  const parsed = extractPaymentTerms(typed);
  if (typeof parsed === "string") return parsed;
  if (parsed?.kind === "deposit") return "deposit_bal";
  return modelTerms;
}
