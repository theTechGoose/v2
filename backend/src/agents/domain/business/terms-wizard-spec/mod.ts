import type { WizardOption, WizardSpec } from "@agents/dto/wizard.ts";
import { t } from "@core/i18n/mod.ts";

/**
 * 5-step terms wizard. Surfaced by the agent in phase 2 (terms).
 * Each step's option `id` lines up with what eventually lands on the
 * quote's `terms` (the agreement half of the Quote + Agreement doc).
 *
 * The previous 10-step wizard collected `config`, `termination`,
 * `dispute`, `governing_state`, and `state_notices` interactively.
 * Those choices are now baked into the agreement templates as static
 * boilerplate (7-day termination, small-claims dispute path, governing
 * law tied to the work-performed state, plus a fuller boilerplate clause
 * set rendered in the public quote page + PDF).
 *
 * The spec is a constant — there's intentionally no DB-driven
 * flexibility yet. If marketing wants to tweak copy, edit this file.
 */
export const TERMS_WIZARD_V1: WizardSpec = {
  id: "terms-v1",
  steps: [
    {
      id: "customer",
      label: "termsWizard.customer.label",
      question: "termsWizard.customer.question",
      options: [
        { id: "use_active", label: "termsWizard.customer.useActive" },
        { id: "pick_existing", label: "termsWizard.customer.pickExisting" },
        {
          id: "create_new",
          label: "termsWizard.customer.createNew",
          isCustom: true,
        },
      ],
    },
    {
      id: "start_date",
      label: "termsWizard.startDate.label",
      question: "termsWizard.startDate.question",
      options: [
        { id: "asap", label: "termsWizard.startDate.asap" },
        { id: "next_week", label: "termsWizard.startDate.nextWeek" },
        { id: "next_month", label: "termsWizard.startDate.nextMonth" },
        {
          // Roadmap p.4/5: paperwork written AFTER the work happened.
          id: "job_completed",
          label: "termsWizard.startDate.jobCompleted",
        },
        { id: "custom", label: "termsWizard.startDate.custom", isCustom: true },
      ],
    },
    {
      id: "wraps",
      label: "termsWizard.wraps.label",
      question: "termsWizard.wraps.question",
      options: [
        { id: "1_day", label: "termsWizard.wraps.oneDay" },
        { id: "2_3_days", label: "termsWizard.wraps.twoThreeDays" },
        { id: "1_week", label: "termsWizard.wraps.oneWeek" },
        { id: "2_weeks", label: "termsWizard.wraps.twoWeeks" },
        {
          id: "job_completed",
          label: "termsWizard.wraps.jobCompleted",
        },
        { id: "custom", label: "termsWizard.wraps.custom", isCustom: true },
      ],
    },
    {
      id: "payment_terms",
      label: "termsWizard.paymentTerms.label",
      question: "termsWizard.paymentTerms.question",
      options: [
        {
          // Roadmap p.6: invoice-style terms — the full amount is due the
          // moment the customer signs (pairs with "Job Completed" above).
          id: "due_now",
          label: "termsWizard.paymentTerms.dueNow.label",
          sub: "termsWizard.paymentTerms.dueNow.sub",
        },
        {
          id: "net_15",
          label: "termsWizard.paymentTerms.net15.label",
          sub: "termsWizard.paymentTerms.net15.sub",
        },
        {
          id: "50_50",
          label: "termsWizard.paymentTerms.fiftyFifty.label",
          sub: "termsWizard.paymentTerms.fiftyFifty.sub",
        },
        {
          id: "30_30_40",
          label: "termsWizard.paymentTerms.thirtyThirtyForty.label",
          sub: "termsWizard.paymentTerms.thirtyThirtyForty.sub",
        },
        {
          id: "deposit_bal",
          label: "termsWizard.paymentTerms.depositBalance.label",
          sub: "termsWizard.paymentTerms.depositBalance.sub",
        },
        {
          id: "custom",
          label: "termsWizard.paymentTerms.custom.label",
          sub: "termsWizard.paymentTerms.custom.sub",
          isCustom: true,
        },
      ],
    },
    {
      id: "warranty",
      label: "termsWizard.warranty.label",
      question: "termsWizard.warranty.question",
      options: [
        { id: "none", label: "termsWizard.warranty.none" },
        { id: "6_months", label: "termsWizard.warranty.sixMonths" },
        { id: "12_months", label: "termsWizard.warranty.twelveMonths" },
        { id: "24_months", label: "termsWizard.warranty.twentyFourMonths" },
        {
          id: "custom_months",
          label: "termsWizard.warranty.custom",
          isCustom: true,
        },
      ],
    },
  ],
};

/** Shorthand to fetch the spec by id (future multi-wizard support). */
export function getWizardSpec(specId: string): WizardSpec {
  if (specId === TERMS_WIZARD_V1.id) return TERMS_WIZARD_V1;
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
