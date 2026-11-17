/**
 * REQ-699 (demo-loop cycle 5, M20) — the terms wizard's "Recurring" payment
 * option. Pair 2 asked "¿y cobro MENSUAL? No hay opción de mensual" (fleet-1
 * stdout:406): a lawn-care contractor's ordinary "$180 al mes" had nowhere
 * to go.
 *
 * How often (weekly / every 2 weeks / monthly — the term's own words, so the
 * chips read like the preview), what each period bills (opened on the
 * quote's total, or the price the message stated) and an optional last day.
 * It submits the recurring term's English base ("Monthly · $180/mo · until
 * 2027-06-30") — the value the quote stores and every reader localizes; the
 * preview shows it in the contractor's language. When the customer signs,
 * Field → Subscriptions bills each period.
 */
import { useState } from "preact/hooks";
import { type Lang, tFor } from "../lib/i18n.ts";
import {
  RECURRING_CADENCES,
  recurringAmountCents,
  type RecurringCadence,
  recurringCadenceName,
  type RecurringTerm,
  recurringTermText,
  recurringTermValue,
} from "../../shared/quote-flow/recurring-billing.ts";

export interface RecurringFormInitial {
  cadence?: RecurringCadence;
  amountCents?: number;
}

/** "180", "180.50" — what the amount box opens with */
function typedAmount(cents: number | undefined): string {
  if (!cents || cents <= 0) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** today, the browser's day, as the date input's `min` */
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function RecurringPaymentForm(props: {
  initial?: RecurringFormInitial;
  sending: boolean;
  lang?: Lang;
  /** the recurring term's English base */
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const { sending, lang = "en", onSubmit, onCancel } = props;
  const [cadence, setCadence] = useState<RecurringCadence>(
    props.initial?.cadence ?? "monthly",
  );
  const [amount, setAmount] = useState(typedAmount(props.initial?.amountCents));
  const [endDate, setEndDate] = useState("");

  const cents = recurringAmountCents(amount);
  const term: RecurringTerm | null = cents
    ? { cadence, amountCents: cents, ...(endDate ? { endDate } : {}) }
    : null;
  const preview = term ? recurringTermText(term, lang) : "—";

  return (
    <div
      class="dur dur--verify"
      style="margin-top:8px"
      data-cy="recurring-form"
    >
      <div class="dur__head">
        <strong class="dur__title">
          {tFor(lang, "termsWizard.paymentTerms.recurring.label")}
        </strong>
        <span class="dur__sub">{tFor(lang, "asstChat.recurring.note")}</span>
      </div>
      <span class="dur__label" id="recurring-cadence">
        {tFor(lang, "asstChat.recurring.cadence")}
      </span>
      <div
        class="dur__presets"
        role="radiogroup"
        aria-labelledby="recurring-cadence"
      >
        {RECURRING_CADENCES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === cadence}
            class={`dur__chip ${c === cadence ? "dur__chip--active" : ""}`}
            data-cy={`recurring-${c}`}
            onClick={() => setCadence(c)}
            disabled={sending}
          >
            {recurringCadenceName(c, lang)}
          </button>
        ))}
      </div>
      <div class="dur__row">
        <label class="dur__label" for="recurring-amount">
          {tFor(lang, "asstChat.recurring.amount")}
        </label>
        <label class="dur__label" for="recurring-end">
          {tFor(lang, "asstChat.recurring.end")}
        </label>
        <input
          id="recurring-amount"
          type="text"
          inputMode="decimal"
          class="cust-pick__search dur__num"
          data-cy="recurring-amount"
          placeholder="180"
          value={amount}
          onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
          aria-invalid={amount.trim() && !cents ? "true" : undefined}
        />
        <input
          id="recurring-end"
          type="date"
          class="cust-pick__search dur__unit"
          data-cy="recurring-end"
          min={todayIso()}
          value={endDate}
          onInput={(e) => setEndDate((e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="dur__preview">
        <span class="dur__preview-label">
          {tFor(lang, "asstChat.verify.agreementReads")}
        </span>
        <span class="dur__preview-val" data-cy="recurring-preview">
          {preview}
        </span>
      </div>
      <div class="cust-create__actions">
        <button
          type="button"
          class="cust-create__btn cust-create__btn--primary"
          data-cy="recurring-use"
          onClick={() => term && onSubmit(recurringTermValue(term))}
          disabled={!term || sending}
        >
          {tFor(lang, "asstChat.recurring.use", { term: preview })}
        </button>
        <button
          type="button"
          class="cust-create__btn"
          onClick={onCancel}
          disabled={sending}
        >
          {tFor(lang, "common.back")}
        </button>
      </div>
    </div>
  );
}
