/**
 * The terms wizard's steps + options, and the rule that turns a wizard pick
 * into an agreement term (REQ-347, demo-loop cycle 1 issue M16).
 *
 * Every `label` / `question` / `sub` is an i18n KEY (lang/*.json). Agreement
 * terms are stored in ENGLISH — the neutral base every reader localizes with
 * localizeTermValue — and are resolved from the pick's step/option ids, never
 * from the transcript text, which is written in the contractor's UI language.
 * The backend (`captureTerms`) and the in-app preview (`previewTermRows`) both
 * use `termFromPick`, so the send card and the agreement cannot disagree.
 *
 * Dependency-free: imported by the backend (#quote-flow/), the front-end
 * island (with .ts) and the Jest unit suite. Translation is injected.
 */
import { isTbdTermValue } from "./terms-i18n.ts";
import { normalizeDepositTerm } from "./deposit-term.ts"; // REQ-678

export interface WizardOptionDef {
  id: string;
  label: string;
  sub?: string;
  /** REQ-491: the sub-line key used instead of `sub` once the quote's total
   *  is known (it names the dollars too). */
  subAmounts?: string;
  /** When true, the user is expected to supply a free-text customValue. */
  isCustom?: boolean;
  /** REQ-678 (c3-m60): picking this option opens an amount picker; the
   *  pick's customValue ("Deposit 30% + balance") is the stored term. */
  amountPicker?: "deposit";
}
export interface WizardStepDef {
  id: string;
  label: string;
  question: string;
  options: WizardOptionDef[];
  hint?: string;
}
export interface WizardSpecDef {
  id: string;
  steps: WizardStepDef[];
}

/** `tFor(lang, key, vars)` (front-end) / `t(lang, key, vars)` (backend). */
export type Translate = (
  lang: "en" | "es",
  key: string,
  vars?: Record<string, string | number>,
) => string;

/**
 * 5-step terms wizard. Surfaced by the agent in phase 2 (terms). Each step's
 * option `id` lines up with what eventually lands on the quote's `terms`.
 * The static boilerplate (termination, dispute path, governing law) lives in
 * the agreement templates, not here.
 */
export const TERMS_WIZARD_V1: WizardSpecDef = {
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
        // REQ-046: "add TBD to when does the job start" — a one-tap pick that
        // lands "TBD" on the agreement's Start row.
        { id: "tbd", label: "termsWizard.startDate.tbd" },
        // NW-23 (REQ-009): "Job completed" is NOT a start date — the client
        // asked for Right away / Next week / Next month / Pick a date.
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
        // REQ-343 (demo-loop cycle 1, p6): no "Job completed" here — a quote
        // is for a job that has not started, so it is not a duration. Old
        // quotes that stored it keep localizing (term-i18n / PDF maps).
        // REQ-047: "… and how long will the job take" — the stored "TBD"
        // prints bare on every reader (no "Estimated" wrapper).
        { id: "tbd", label: "termsWizard.wraps.tbd" },
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
          // REQ-491 (demo m60): the sub-line names the split it bills —
          // "20% upfront, rest when done · $90 / $360".
          sub: "termsWizard.paymentTerms.depositBalance.sub",
          subAmounts: "termsWizard.paymentTerms.depositBalance.subAmounts",
          // REQ-678 (demo c3-m60): then "how much upfront?" — 10 / 20 / 30 /
          // 50 % or a custom $, stored as "Deposit 30% + balance".
          amountPicker: "deposit",
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
function sharedStep(id: string): WizardStepDef {
  const step = TERMS_WIZARD_V1.steps.find((s) => s.id === id);
  if (!step) throw new Error(`terms wizard has no step "${id}"`);
  return step;
}

/**
 * REQ-343 (demo-loop cycle 1, p3 + p6): the quote wizard for a SERVICE trade
 * (cleaning, lawn care, junk removal — see `tradeKindFor`). Its jobs are
 * measured in hours, so the duration step leads with 2 hours / 4 hours /
 * half a day; and it carries no workmanship warranty, so the warranty step is
 * gone (the same as answering "No warranty": no warranty row is printed).
 * Customer, start date and payment terms are the generic wizard's step
 * objects. Its own id, so a mid-wizard answer resolves it by `specId`.
 */
export const TERMS_WIZARD_SERVICE_V1: WizardSpecDef = {
  id: "terms-service-v1",
  steps: [
    sharedStep("customer"),
    sharedStep("start_date"),
    {
      id: "wraps",
      label: "termsWizard.wraps.label",
      question: "termsWizard.wraps.question",
      options: [
        { id: "2_hours", label: "termsWizard.wraps.twoHours" },
        { id: "4_hours", label: "termsWizard.wraps.fourHours" },
        { id: "half_day", label: "termsWizard.wraps.halfDay" },
        { id: "1_day", label: "termsWizard.wraps.oneDay" },
        { id: "2_3_days", label: "termsWizard.wraps.twoThreeDays" },
        { id: "tbd", label: "termsWizard.wraps.tbd" },
        { id: "custom", label: "termsWizard.wraps.custom", isCustom: true },
      ],
    },
    sharedStep("payment_terms"),
  ],
};

/**
 * REQ-024 (NW-13 / NW-18): "Job done, need to invoice" without an accepted
 * quote runs the SAME wizard as a quote — minus start date and duration,
 * plus the completion date ("skip how long it took, but ask for the
 * completion date"). The answers land on the agreement row the invoice is
 * derived from, so /i/:id shows the terms and the job details.
 */
export const INVOICE_WIZARD_V1: WizardSpecDef = {
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
        {
          id: "custom",
          label: "termsWizard.completionDate.custom",
          isCustom: true,
        },
      ],
    },
    sharedStep("payment_terms"),
    sharedStep("warranty"),
  ],
};

/** Every step any wizard knows. A step id can repeat across wizards with
 *  different options (the service wizard's `wraps`, REQ-343), so a pick is
 *  resolved against the step that actually offers its option. */
const ALL_STEPS: readonly WizardStepDef[] = [
  ...TERMS_WIZARD_V1.steps,
  ...[...INVOICE_WIZARD_V1.steps, ...TERMS_WIZARD_SERVICE_V1.steps].filter((
    s,
  ) => !TERMS_WIZARD_V1.steps.includes(s)),
];

export interface AgreementTerm {
  stepId: string;
  label: string;
  value: string;
}

/**
 * The agreement term a wizard pick stands for, in ENGLISH: the step's label
 * and the picked option's label; a custom option's value is the contractor's
 * free text. Null for an unknown step or an empty custom value.
 */
export function termFromPick(
  pick: { stepId: string; optionId?: string; customValue?: string },
  t: Translate,
  steps: readonly WizardStepDef[] = ALL_STEPS,
): AgreementTerm | null {
  const candidates = steps.filter((s) => s.id === pick.stepId);
  const stepDef =
    candidates.find((s) => s.options.some((o) => o.id === pick.optionId)) ??
      candidates[0];
  if (!stepDef) return null;
  const optionDef = stepDef.options.find((o) => o.id === pick.optionId);
  // REQ-678: an amount-picker option stores the picked amount; anything
  // that is not a deposit amount falls back to the option's label.
  const value = (!optionDef || optionDef.isCustom)
    ? (pick.customValue ?? "").trim()
    : (optionDef.amountPicker === "deposit"
      ? normalizeDepositTerm(pick.customValue)
      : null) ?? t("en", optionDef.label);
  if (!value) return null;
  return { stepId: pick.stepId, label: t("en", stepDef.label), value };
}

/** A chat message as the preview sees it (kind, content, payload). */
export interface PreviewMessage {
  kind?: string;
  content?: string;
  payload?: unknown;
}

/**
 * The preview's English-base term rows, before localization: the quote's
 * stored `terms` when it has any, else the wizard picks in the transcript —
 * resolved from their ids (termFromPick). Only a legacy pick that carries no
 * ids falls back to the "Label: value" text. The customer step is skipped
 * (the card renders the customer block itself); a re-edited step keeps its
 * latest pick, in the order the steps were first answered.
 */
export function baseTermRows(input: {
  quoteTerms?: readonly AgreementTerm[] | null;
  messages: readonly PreviewMessage[];
  t: Translate;
}): AgreementTerm[] {
  const { quoteTerms, messages, t } = input;
  const byStep = new Map<string, AgreementTerm & { firstIdx: number }>();
  if (Array.isArray(quoteTerms) && quoteTerms.length > 0) {
    quoteTerms.forEach((term, i) => {
      if (!term?.stepId || term.stepId === "customer") return;
      byStep.set(term.stepId, { ...term, firstIdx: i });
    });
  } else {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      const p = m.payload as
        | { wizardStepId?: string; optionId?: string; customValue?: string }
        | undefined;
      const sid = p?.wizardStepId;
      if (m.kind !== "text" || !sid || sid === "customer") continue;
      if (byStep.has(sid)) continue;
      let term: AgreementTerm | null;
      if (p?.optionId || p?.customValue) {
        term = termFromPick({ stepId: sid, ...p }, t);
      } else {
        const raw = m.content ?? "";
        const colon = raw.indexOf(":");
        term = {
          stepId: sid,
          label: colon === -1 ? raw : raw.slice(0, colon).trim(),
          value: colon === -1 ? "" : raw.slice(colon + 1).trim(),
        };
      }
      if (term) byStep.set(sid, { ...term, firstIdx: i });
    }
  }
  return Array.from(byStep.values())
    .sort((a, b) => a.firstIdx - b.firstIdx)
    .map(({ stepId, label, value }) => ({ stepId, label, value }));
}

/**
 * The quote-review card's term rows in `previewLang`: the English base
 * (baseTermRows) localized with `localize` (localizeTermValue), the "No
 * warranty" row dropped (the agreement's fine print still applies), and a
 * duration wrapped as an estimate ("Estimated: 1 day") — never a TBD one
 * (REQ-047). Labels stay the base; the card resolves them by stepId.
 */
export function previewTermRows(input: {
  quoteTerms?: readonly AgreementTerm[] | null;
  messages: readonly PreviewMessage[];
  previewLang: "en" | "es";
  t: Translate;
  localize: (value: string, lang: "en" | "es") => string;
}): AgreementTerm[] {
  const { previewLang, t, localize } = input;
  return baseTermRows(input)
    .filter(({ stepId, value }) => {
      if (stepId !== "warranty") return true;
      const v = value.trim().toLowerCase();
      return !(v === "" || v === "no warranty" ||
        v === "none" || v === "n/a" || v === "no");
    })
    .map(({ stepId, label, value }) => {
      const v = localize(value, previewLang);
      // Strip any existing "Estimated/Estimado" prefix(es) first so the
      // wrapper is idempotent (legacy rows sometimes stored it pre-wrapped).
      const isDuration = stepId === "time_to_complete" || stepId === "wraps";
      const bare = isDuration
        ? v.replace(/^(?:\s*estima(?:ted|d[oa])\b\s*:?\s*)+/i, "").trim()
        : v;
      return {
        stepId,
        label,
        value: isDuration && bare && !isTbdTermValue(value)
          ? t(previewLang, "asstChat.preview.estimatedValue", { value: bare })
          : v,
      };
    });
}

/**
 * REQ-347: after a wizard answer the island re-reads the quote; the backend
 * persists the terms (and an invoice's completion date) on the last answer.
 * Take those onto the island's copy of the same quote — nothing else, so
 * local edits survive. A different (or no) current quote is left alone.
 */
export function mergeFreshTerms<
  Q extends { id: string },
  F extends { id: string; terms?: unknown; estimatedCompletionDate?: unknown },
>(cur: Q | undefined, fresh: F): Q | undefined {
  if (!cur || cur.id !== fresh.id) return cur;
  return {
    ...cur,
    terms: fresh.terms,
    ...(fresh.estimatedCompletionDate !== undefined
      ? { estimatedCompletionDate: fresh.estimatedCompletionDate }
      : {}),
  };
}
