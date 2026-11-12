/**
 * PaymentReceivedForm — REQ-018 (NW-27 / NW-32).
 *
 * The contractor says "payment received" for an invoice the customer never
 * claimed online (cash, check, Zelle told to them in person): pick how they
 * paid (all nine methods), the amount (prefilled with the balance still
 * owed — REQ-551),
 * the date, an optional reference, then POST /payments. The backend re-runs
 * ComputeInvoiceBalance and flips the invoice to paid when the balance hits
 * zero, and the row lands on /payments.
 *
 * REQ-551 (demo-loop cycle 4, B2): an amount above the balance asks
 * "record it anyway?" inline before anything is sent (the request then says
 * `override: true`); above 10x the invoice it is refused. POST /payments
 * applies the same rule, so a stale balance comes back as the same question.
 *
 * Rendered inside the InvoicesPage island (detail panel, "pay" mode).
 */
import { useState } from "preact/hooks";
import { type PaymentMethod, paymentsClient } from "../clients/payments.ts";
import { type Lang, tFor } from "../lib/i18n.ts";
import {
  overpaymentFromError,
  paymentErrorText,
  type PaymentReceivedResult,
  validatePaymentReceived,
} from "../lib/payment-received.ts";

const METHODS: PaymentMethod[] = [
  "cash",
  "check",
  "zelle",
  "venmo",
  "cashapp",
  "paypal",
  "card",
  "ach",
  "other",
];

const METHOD_KEY: Record<PaymentMethod, string> = {
  cash: "paymentMethod.cash",
  check: "paymentMethod.check",
  ach: "paymentsPage.method.ach",
  card: "paymentsPage.method.card",
  venmo: "paymentMethod.venmo",
  zelle: "paymentMethod.zelle",
  cashapp: "paymentMethod.cashApp",
  paypal: "paymentMethod.paypal",
  other: "paymentMethod.other",
};

const LINE = "var(--border,#d8dcd5)";
const GREEN = "var(--brand-green,#519843)";
const INK = "var(--fg,#144852)";

export default function PaymentReceivedForm(
  { invoiceId, amountCents, paidCents, lang, onSaved, onCancel }: {
    invoiceId: string;
    /** Invoice total, INTEGER CENTS. */
    amountCents?: number;
    /** REQ-551: already received on the invoice, INTEGER CENTS. The amount
     *  field is prefilled with the balance (total − this). */
    paidCents?: number;
    lang: Lang;
    /** REQ-322: told the recorded amount (INTEGER CENTS) so the page can
     *  confirm "Payment of $X recorded". */
    onSaved: (cents: number) => void | Promise<void>;
    onCancel: () => void;
  },
) {
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [dollars, setDollars] = useState(() => {
    if (amountCents == null) return "";
    const balance = Math.max(0, amountCents - (paidCents ?? 0));
    return String((balance > 0 ? balance : amountCents) / 100);
  });
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // REQ-551: the "record it anyway?" question, when the amount is above
  // the balance.
  const [overAsk, setOverAsk] = useState<string | null>(null);

  const fieldStyle =
    `width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid ${LINE};border-radius:8px;font:inherit;font-size:13.5px`;
  const labelStyle =
    "display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:var(--fg-muted,#6b7560)";

  /** REQ-551: show a refusal — the overpayment question gets its own box
   *  with a "Record anyway" button, everything else is the error line. */
  function showRefusal(v: Extract<PaymentReceivedResult, { ok: false }>) {
    const text = tFor(lang, v.errKey, v.vars);
    if (v.confirmOver) {
      setErr(null);
      setOverAsk(text);
    } else {
      setOverAsk(null);
      setErr(text);
    }
  }

  async function submit(e: Event, confirmedOver = false) {
    e.preventDefault();
    if (busy) return;
    // REQ-322 (demo m36): method → amount → date, each with its own reason,
    // and the date is checked BEFORE any instant is built so a cleared
    // "Received on" never throws its way into the generic errSave.
    // REQ-551: then the amount against the balance still owed.
    const v = validatePaymentReceived({
      method,
      dollars,
      date,
      amountCents,
      paidCents,
      confirmedOver,
    });
    if (!v.ok) {
      showRefusal(v);
      return;
    }
    setErr(null);
    setOverAsk(null);
    setBusy(true);
    try {
      await paymentsClient.create({
        invoiceId,
        amount: v.cents,
        method: v.method,
        receivedAt: v.receivedAt,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(v.override ? { override: true } : {}),
      });
      await onSaved(v.cents);
    } catch (e) {
      const over = overpaymentFromError(e);
      if (over && !over.ok) showRefusal(over);
      else setErr(paymentErrorText(lang, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      // REQ-322: the form's own localized reasons (method, amount, date) are
      // the feedback — the browser's native bubble would swallow the submit
      // and say nothing in the user's language.
      noValidate
      data-cy="pay-received-form"
      style="display:flex;flex-direction:column;gap:10px"
    >
      <div style={`font-size:14px;font-weight:800;color:${INK}`}>
        {tFor(lang, "invoicesPage.pay.title")}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        {METHODS.map((m) => {
          const active = m === method;
          return (
            <button
              type="button"
              key={m}
              data-cy={`pay-method-${m}`}
              aria-pressed={active}
              onClick={() => setMethod(m)}
              style={`appearance:none;cursor:pointer;background:${
                active ? GREEN : "#fff"
              };color:${active ? "#fff" : INK};border:1px solid ${
                active ? GREEN : LINE
              };border-radius:999px;padding:8px 14px;font:inherit;font-size:13px;font-weight:700`}
            >
              {tFor(lang, METHOD_KEY[m])}
            </button>
          );
        })}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label style={labelStyle}>
          {tFor(lang, "invoicesPage.pay.amountLabel")}
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            data-cy="pay-received-amount"
            value={dollars}
            onInput={(e) => {
              setDollars((e.target as HTMLInputElement).value);
              setOverAsk(null); // REQ-551: a new amount is a new question
            }}
            style={fieldStyle}
          />
        </label>
        <label style={labelStyle}>
          {tFor(lang, "invoicesPage.pay.dateLabel")}
          <input
            type="date"
            required
            data-cy="pay-received-date"
            value={date}
            onInput={(e) => setDate((e.target as HTMLInputElement).value)}
            style={fieldStyle}
          />
        </label>
      </div>
      <label style={labelStyle}>
        {tFor(lang, "invoicesPage.pay.referenceLabel")}
        <input
          type="text"
          data-cy="pay-received-reference"
          value={reference}
          onInput={(e) => setReference((e.target as HTMLInputElement).value)}
          style={fieldStyle}
        />
      </label>
      {overAsk && (
        <div
          role="alert"
          data-cy="pay-received-over"
          style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;border-radius:9px;background:var(--amber-50,#fff7e6);border:1px solid var(--amber-300,#f0c36d);font-size:12.5px;font-weight:700;color:var(--fg,#144852)"
        >
          <span style="flex:1 1 200px">{overAsk}</span>
          <button
            type="button"
            data-cy="pay-received-over-confirm"
            disabled={busy}
            onClick={(e) => submit(e, true)}
            style={`appearance:none;cursor:pointer;background:#fff;color:${INK};border:1px solid ${LINE};border-radius:9px;padding:6px 12px;font:inherit;font-size:12.5px;font-weight:800`}
          >
            {tFor(lang, "invoicesPage.pay.confirmOverBtn")}
          </button>
        </div>
      )}
      {err && (
        <div
          data-cy="pay-received-error"
          style="font-size:12.5px;font-weight:700;color:var(--pink-700,#d94e4e)"
        >
          {err}
        </div>
      )}
      <div style="display:flex;gap:8px;align-items:center">
        <button
          type="submit"
          data-cy="pay-received-submit"
          disabled={busy}
          style={`appearance:none;cursor:pointer;border:0;border-radius:9px;padding:8px 14px;background:${GREEN};color:#fff;font:inherit;font-size:13px;font-weight:800`}
        >
          {busy ? "…" : tFor(lang, "invoicesPage.pay.submit")}
        </button>
        <button
          type="button"
          data-cy="pay-received-cancel"
          onClick={onCancel}
          style="appearance:none;cursor:pointer;background:none;border:0;padding:8px 10px;font:inherit;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560)"
        >
          {tFor(lang, "invoicesPage.pay.cancel")}
        </button>
      </div>
    </form>
  );
}
