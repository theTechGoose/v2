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
        // NW-23 (REQ-009): "Job completed" is NOT a start date — the client
        // asked for Right away / Next week / Next month / Pick a date. The
        // duration (wraps) step keeps its own job_completed option.
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

/** One shared step by id — the invoice wizard reuses the quote wizard's
 *  step OBJECTS so every option, label and custom-value rule stays identical. */
function sharedStep(id: string) {
  const step = TERMS_WIZARD_V1.steps.find((s) => s.id === id);
  if (!step) throw new Error(`terms wizard has no step "${id}"`);
  return step;
}

/**
 * REQ-024 (NW-13 / NW-18): "Job done, need to invoice" without an accepted
 * quote runs the SAME wizard as a quote — minus start date and duration,
 * plus the completion date ("skip how long it took, but ask for the
 * completion date"). The answers land on the agreement row the invoice is
 * derived from, so /i/:id shows the terms and the job details.
 */
export const INVOICE_WIZARD_V1: WizardSpec = {
  id: "invoice-v1",
  steps: [
    sharedStep("customer"),
    {
      id: "completion_date",
      label: "termsWizard.completionDate.label",
      question: "termsWizard.completionDate.question",
      options: [
        { id: "today", label: "termsWizard.completionDate.today" },
        { id: "yesterday", label: "termsWizard.completionDate.yesterday" },
        { id: "last_week", label: "termsWizard.completionDate.lastWeek" },
        { id: "custom", label: "termsWizard.completionDate.custom", isCustom: true },
      ],
    },
    sharedStep("payment_terms"),
    sharedStep("warranty"),
  ],
};

/** Every wizard this module knows, by id. */
export const WIZARD_SPECS: Record<string, WizardSpec> = {
  [TERMS_WIZARD_V1.id]: TERMS_WIZARD_V1,
  [INVOICE_WIZARD_V1.id]: INVOICE_WIZARD_V1,
};

/** Fetch a spec by id — the quote wizard ("terms-v1") or the invoice
 *  wizard ("invoice-v1", REQ-024). */
export function getWizardSpec(specId: string): WizardSpec {
  const spec = WIZARD_SPECS[specId];
  if (spec) return spec;
  throw new Error(`unknown wizard spec: ${specId}`);
}

/** The wizard for a document kind (REQ-024). */
export function wizardSpecFor(docKind: "quote" | "invoice" | undefined): WizardSpec {
  return docKind === "invoice" ? INVOICE_WIZARD_V1 : TERMS_WIZARD_V1;
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
