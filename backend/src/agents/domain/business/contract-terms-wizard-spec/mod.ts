import type { WizardSpec } from "@agents/dto/wizard.ts";

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
      label: "Customer",
      question:
        "We've locked the quote down! Is this for a business or a person?",
      options: [
        { id: "use_active", label: "Use the customer from chat" },
        { id: "pick_existing", label: "Pick an existing customer" },
        {
          id: "create_new",
          label: "Add a new business or person",
          isCustom: true,
        },
      ],
    },
    {
      id: "start_date",
      label: "Start",
      question: "When does the job start?",
      options: [
        { id: "asap", label: "Right away" },
        { id: "next_week", label: "Next week" },
        { id: "next_month", label: "Next Month" },
        { id: "custom", label: "Pick a date", isCustom: true },
      ],
    },
    {
      id: "wraps",
      label: "Time to complete",
      question: "How long will the job take?",
      options: [
        { id: "1_day", label: "1 day" },
        { id: "2_3_days", label: "2–3 days" },
        { id: "1_week", label: "1 week" },
        { id: "2_weeks", label: "2 weeks" },
        { id: "custom", label: "Custom", isCustom: true },
      ],
    },
    {
      id: "payment_terms",
      label: "Payment",
      question: "When do you want to get paid?",
      options: [
        {
          id: "net_15",
          label: "Get paid on completion",
          sub: "Same-day payment",
        },
        { id: "50_50", label: "50/50", sub: "Half upfront, half when done" },
        { id: "30_30_40", label: "30/30/40", sub: "Start, halfway, done" },
        {
          id: "deposit_bal",
          label: "Deposit + balance",
          sub: "Small upfront, rest when done",
        },
        {
          id: "custom",
          label: "Custom",
          sub: "Set your own terms",
          isCustom: true,
        },
      ],
    },
    {
      id: "warranty",
      label: "warranty",
      question: "How long do you stand behind your work?",
      options: [
        { id: "none", label: "No warranty" },
        { id: "6_months", label: "6 months" },
        { id: "12_months", label: "12 months" },
        { id: "24_months", label: "24 months" },
        { id: "custom_months", label: "Custom", isCustom: true },
      ],
    },
  ],
};

/** Shorthand to fetch the spec by id (future multi-wizard support). */
export function getWizardSpec(specId: string): WizardSpec {
  if (specId === CONTRACT_TERMS_WIZARD_V1.id) return CONTRACT_TERMS_WIZARD_V1;
  throw new Error(`unknown wizard spec: ${specId}`);
}
