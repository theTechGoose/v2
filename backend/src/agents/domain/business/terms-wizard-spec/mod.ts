import type {
  WizardOption,
  WizardSpec,
  WizardStep,
} from "@agents/dto/wizard.ts";
import { t } from "@core/i18n/mod.ts";
import {
  INVOICE_WIZARD_V1 as SHARED_INVOICE_WIZARD_V1,
  TERMS_WIZARD_SERVICE_V1 as SHARED_TERMS_WIZARD_SERVICE_V1,
  TERMS_WIZARD_V1 as SHARED_TERMS_WIZARD_V1,
} from "#quote-flow/wizard-terms.ts";
import type { TradeKind } from "#quote-flow/trade-fit.ts";
import { accountNetDays } from "#quote-flow/completion-schedule.ts"; // REQ-411

/**
 * The quote's terms wizard (5 steps) and the invoice wizard (REQ-024). The
 * step/option catalog lives in the shared module (REQ-347) so the in-app
 * preview resolves a pick's English term with the same labels the backend
 * persists; this module types it as the agents' WizardSpec.
 *
 * The spec is a constant — there's intentionally no DB-driven
 * flexibility yet. If marketing wants to tweak copy, edit the shared file.
 */
export const TERMS_WIZARD_V1: WizardSpec = SHARED_TERMS_WIZARD_V1;

/** REQ-024 (NW-13 / NW-18): the invoice wizard — customer → completion date
 *  → payment → warranty (the shared module documents the why). */
export const INVOICE_WIZARD_V1: WizardSpec = SHARED_INVOICE_WIZARD_V1;

/** REQ-343 (demo-loop cycle 1, p3 + p6): the quote wizard for a SERVICE
 *  trade — hours presets, no warranty step (the shared module documents it). */
export const TERMS_WIZARD_SERVICE_V1: WizardSpec =
  SHARED_TERMS_WIZARD_SERVICE_V1;

/** Every wizard this module knows, by id. */
export const WIZARD_SPECS: Record<string, WizardSpec> = {
  [TERMS_WIZARD_V1.id]: TERMS_WIZARD_V1,
  [INVOICE_WIZARD_V1.id]: INVOICE_WIZARD_V1,
  [TERMS_WIZARD_SERVICE_V1.id]: TERMS_WIZARD_SERVICE_V1,
};

/** Fetch a spec by id — the quote wizard ("terms-v1") or the invoice
 *  wizard ("invoice-v1", REQ-024). */
export function getWizardSpec(specId: string): WizardSpec {
  const spec = WIZARD_SPECS[specId];
  if (spec) return spec;
  throw new Error(`unknown wizard spec: ${specId}`);
}

/** The wizard for a document kind (REQ-024) and the business's trade
 *  (REQ-343): a service trade's quote gets hours and no warranty step. The
 *  invoice wizard ignores the trade. */
export function wizardSpecFor(
  docKind: "quote" | "invoice" | undefined,
  tradeKind: TradeKind = "project",
): WizardSpec {
  if (docKind === "invoice") return INVOICE_WIZARD_V1;
  return tradeKind === "service" ? TERMS_WIZARD_SERVICE_V1 : TERMS_WIZARD_V1;
}

/**
 * The spec stores i18n KEYS for every `label` / `question` / `sub` so the
 * wizard can be emitted in the contractor's language. Resolve a step's option
 * labels (+ sublabels) into `lang` at emission time. The step `question` and
 * `label` resolve with a plain `t(lang, step.question)` / `t(lang, step.label)`.
 */
/**
 * REQ-331 (demo m7 / m44): the customer step's question when the thread
 * already carries a customer — "use them, or pick another?" instead of
 * "Is this for a business or a person?" (which the demo read as the
 * assistant forgetting a customer it had just been told about). Every
 * other step, and the customer step with nobody bound, keeps its own key.
 */
export function stepQuestionKey(
  step: Pick<WizardStep, "id" | "question">,
  hasBoundCustomer: boolean,
): string {
  if (step.id === "customer" && hasBoundCustomer) {
    return "termsWizard.customer.questionKnown";
  }
  return step.question;
}

/** REQ-411 (demo-loop cycle 2, m35): `vars` fill the sub-lines — `{n}` is
 *  the account's days to pay ("Billed when the job is done · the customer
 *  then has {n} days to pay", REQ-483), so the wizard never contradicts
 *  Settings. */
export function localizeOptions(
  options: WizardOption[],
  lang: "en" | "es",
  vars: { n: number } = { n: accountNetDays(undefined) },
): WizardOption[] {
  return options.map((o) => ({
    ...o,
    label: t(lang, o.label),
    ...(o.sub ? { sub: t(lang, o.sub, vars) } : {}),
  }));
}
