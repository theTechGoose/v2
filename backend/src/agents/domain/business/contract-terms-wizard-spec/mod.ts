import type { WizardOption, WizardSpec } from "@agents/dto/wizard.ts";
import { t } from "@core/i18n/mod.ts";

/**
 * 5-step contract-terms wizard. Surfaced by the agent in phase 2 (terms).
 * Each step's option `id` lines up with what eventually lands on the
 * Contract DTO (see backend.md §3.A wizard step table).
 *
 * The previous 10-step wizard collected `config`, `termination`,
 * `dispute`, `governing_state`, and `state_notices` interactively.
 * Those choices are now baked into the contract templates as static
 * boilerplate (7-day termination, small-claims dispute path, governing
 * law tied to the work-performed state, plus a fuller boilerplate clause
 * set rendered in the contract page + PDF).
 *
 * The spec is a constant — there's intentionally no DB-driven
 * flexibility yet. If marketing wants to tweak copy, edit this file.
 */
export const CONTRACT_TERMS_WIZARD_V1: WizardSpec = {
  id: "contract-terms-v1",
  steps: [
    {
      id: "customer",
      label: "contractTermsWizard.customer.label",
      question: "contractTermsWizard.customer.question",
      options: [
        { id: "use_active", label: "contractTermsWizard.customer.useActive" },
        { id: "pick_existing", label: "contractTermsWizard.customer.pickExisting" },
        {
          id: "create_new",
          label: "contractTermsWizard.customer.createNew",
          isCustom: true,
        },
      ],
    },
    {
      id: "start_date",
      label: "contractTermsWizard.startDate.label",
      question: "contractTermsWizard.startDate.question",
      options: [
        { id: "asap", label: "contractTermsWizard.startDate.asap" },
        { id: "next_week", label: "contractTermsWizard.startDate.nextWeek" },
        { id: "next_month", label: "contractTermsWizard.startDate.nextMonth" },
        {
          // Roadmap p.4/5: paperwork written AFTER the work happened.
          id: "job_completed",
          label: "contractTermsWizard.startDate.jobCompleted",
        },
        { id: "custom", label: "contractTermsWizard.startDate.custom", isCustom: true },
      ],
    },
    {
      id: "wraps",
      label: "contractTermsWizard.wraps.label",
      question: "contractTermsWizard.wraps.question",
      options: [
        { id: "1_day", label: "contractTermsWizard.wraps.oneDay" },
        { id: "2_3_days", label: "contractTermsWizard.wraps.twoThreeDays" },
        { id: "1_week", label: "contractTermsWizard.wraps.oneWeek" },
        { id: "2_weeks", label: "contractTermsWizard.wraps.twoWeeks" },
        {
          id: "job_completed",
          label: "contractTermsWizard.wraps.jobCompleted",
        },
        { id: "custom", label: "contractTermsWizard.wraps.custom", isCustom: true },
      ],
    },
    {
      id: "payment_terms",
      label: "contractTermsWizard.paymentTerms.label",
      question: "contractTermsWizard.paymentTerms.question",
      options: [
        {
          // Roadmap p.6: invoice-style terms — the full amount is due the
          // moment the customer signs (pairs with "Job Completed" above).
          id: "due_now",
          label: "contractTermsWizard.paymentTerms.dueNow.label",
          sub: "contractTermsWizard.paymentTerms.dueNow.sub",
        },
        {
          id: "net_15",
          label: "contractTermsWizard.paymentTerms.net15.label",
          sub: "contractTermsWizard.paymentTerms.net15.sub",
        },
        {
          id: "50_50",
          label: "contractTermsWizard.paymentTerms.fiftyFifty.label",
          sub: "contractTermsWizard.paymentTerms.fiftyFifty.sub",
        },
        {
          id: "30_30_40",
          label: "contractTermsWizard.paymentTerms.thirtyThirtyForty.label",
          sub: "contractTermsWizard.paymentTerms.thirtyThirtyForty.sub",
        },
        {
          id: "deposit_bal",
          label: "contractTermsWizard.paymentTerms.depositBalance.label",
          sub: "contractTermsWizard.paymentTerms.depositBalance.sub",
        },
        {
          id: "custom",
          label: "contractTermsWizard.paymentTerms.custom.label",
          sub: "contractTermsWizard.paymentTerms.custom.sub",
          isCustom: true,
        },
      ],
    },
    {
      id: "warranty",
      label: "contractTermsWizard.warranty.label",
      question: "contractTermsWizard.warranty.question",
      options: [
        { id: "none", label: "contractTermsWizard.warranty.none" },
        { id: "6_months", label: "contractTermsWizard.warranty.sixMonths" },
        { id: "12_months", label: "contractTermsWizard.warranty.twelveMonths" },
        { id: "24_months", label: "contractTermsWizard.warranty.twentyFourMonths" },
        { id: "custom_months", label: "contractTermsWizard.warranty.custom", isCustom: true },
      ],
    },
  ],
};

/** Shorthand to fetch the spec by id (future multi-wizard support). */
export function getWizardSpec(specId: string): WizardSpec {
  if (specId === CONTRACT_TERMS_WIZARD_V1.id) return CONTRACT_TERMS_WIZARD_V1;
  throw new Error(`unknown wizard spec: ${specId}`);
}

/**
 * The spec stores i18n KEYS for every `label` / `question` / `sub` so the
 * wizard can be emitted in the contractor's language. Resolve a step's option
 * labels (+ sublabels) into `lang` at emission time. The step `question` and
 * `label` resolve with a plain `t(lang, step.question)` / `t(lang, step.label)`.
 */
export function localizeOptions(
  options: WizardOption[],
  lang: "en" | "es",
): WizardOption[] {
  return options.map((o) => ({
    ...o,
    label: t(lang, o.label),
    ...(o.sub ? { sub: t(lang, o.sub) } : {}),
  }));
}
