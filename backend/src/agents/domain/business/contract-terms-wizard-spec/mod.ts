import type { WizardSpec } from "@agents/dto/wizard.ts";

/**
 * The canonical 10-step contract-terms wizard. Surfaced by the agent in
 * phase 2 (terms). Each step's option `id` lines up with what eventually
 * lands on the Contract DTO (see backend.md §3.A wizard step table).
 *
 * The spec is a constant — there's intentionally no DB-driven flexibility
 * yet. If marketing wants to tweak copy, edit this file.
 */
export const CONTRACT_TERMS_WIZARD_V1: WizardSpec = {
  id: "contract-terms-v1",
  steps: [
    {
      id: "config",
      label: "Config",
      question: "Pick a starting preset:",
      options: [
        { id: "standard_residential", label: "Standard residential",  sub: "Most homes, simple jobs" },
        { id: "standard_commercial",  label: "Standard commercial",   sub: "Businesses, HOAs" },
        { id: "blank",                 label: "Start blank",            sub: "I'll choose every option" },
      ],
    },
    {
      id: "customer",
      label: "Customer",
      question: "Who is this contract for?",
      options: [
        { id: "use_active",          label: "Use the customer from chat" },
        { id: "pick_existing",       label: "Pick an existing customer" },
        { id: "create_new",          label: "Create a new customer", isCustom: true },
      ],
    },
    {
      id: "start_date",
      label: "Start",
      question: "When does the work start?",
      options: [
        { id: "asap",       label: "ASAP",            sub: "Within 7 days" },
        { id: "next_week",  label: "Next week",        sub: "7–14 days out" },
        { id: "next_month", label: "Next month",       sub: "30+ days out" },
        { id: "custom",     label: "Pick a date",      isCustom: true },
      ],
    },
    {
      id: "wraps",
      label: "Wraps",
      question: "How long until substantial completion?",
      options: [
        { id: "1_day",   label: "1 day" },
        { id: "2_3_days", label: "2–3 days" },
        { id: "1_week",  label: "1 week" },
        { id: "2_weeks", label: "2 weeks" },
        { id: "custom",  label: "Custom duration", isCustom: true },
      ],
    },
    {
      id: "payment_terms",
      label: "Payment terms",
      question: "How do you want to get paid?",
      options: [
        { id: "50_50",      label: "50 / 50",            sub: "Half deposit, half on finish" },
        { id: "30_30_40",   label: "30 / 30 / 40",       sub: "Deposit, midpoint, finish" },
        { id: "net_15",     label: "Net 15 — full",      sub: "Due 15 days after wrap" },
        { id: "deposit_bal",label: "Deposit + balance",  sub: "Small hold, balance on finish" },
        { id: "custom",     label: "Custom",              isCustom: true },
      ],
      hint: "Defaults: Net 15 · 1.5% late fee — editable after picking",
    },
    {
      id: "warranty",
      label: "Warranty",
      question: "What warranty do you stand behind?",
      options: [
        { id: "none",           label: "No warranty" },
        { id: "6_months",       label: "6 months" },
        { id: "12_months",      label: "12 months" },
        { id: "24_months",      label: "24 months" },
        { id: "custom_months",  label: "Custom", isCustom: true },
      ],
    },
    {
      id: "termination",
      label: "Termination",
      question: "How much notice to terminate the contract?",
      options: [
        { id: "7",  label: "7 days" },
        { id: "14", label: "14 days" },
        { id: "30", label: "30 days" },
        { id: "custom", label: "Custom", isCustom: true },
      ],
    },
    {
      id: "dispute",
      label: "Dispute",
      question: "How do you want to handle disputes?",
      options: [
        { id: "mediation",   label: "Mediation",   sub: "Try to settle informally first" },
        { id: "arbitration", label: "Arbitration", sub: "Binding decision, no court" },
        { id: "court",       label: "Court",       sub: "Standard small-claims path" },
      ],
    },
    {
      id: "governing_state",
      label: "Governing state",
      question: "Which state's laws govern the contract?",
      options: [
        { id: "use_business_state", label: "Use my business state" },
        { id: "use_job_state",      label: "Use the job site state" },
        { id: "custom",              label: "Pick a different state", isCustom: true },
      ],
    },
    {
      id: "state_notices",
      label: "State notices",
      question: "Auto-include the legally required state notices?",
      options: [
        { id: "yes",   label: "Yes",     sub: "Recommended" },
        { id: "no",    label: "No",       sub: "I'll add my own" },
        { id: "review",label: "Review first", sub: "Show me what's included" },
      ],
    },
  ],
};

/** Shorthand to fetch the spec by id (future multi-wizard support). */
export function getWizardSpec(specId: string): WizardSpec {
  if (specId === CONTRACT_TERMS_WIZARD_V1.id) return CONTRACT_TERMS_WIZARD_V1;
  throw new Error(`unknown wizard spec: ${specId}`);
}
