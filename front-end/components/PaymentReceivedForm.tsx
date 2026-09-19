/**
 * PaymentReceivedForm — REQ-018 (NW-27 / NW-32).
 *
 * The contractor says "payment received" for an invoice the customer never
 * claimed online (cash, check, Zelle told to them in person): pick how they
 * paid (all nine methods), the amount (prefilled with the invoice total),
 * the date, an optional reference, then POST /payments. The backend re-runs
 * ComputeInvoiceBalance and flips the invoice to paid when the balance hits
 * zero, and the row lands on /payments.
 *
 * Rendered inside the InvoicesPage island (detail panel, "pay" mode).
 */
import { useState } from "preact/hooks";
import { type PaymentMethod, paymentsClient } from "../clients/payments.ts";
import { type Lang, tFor } from "../lib/i18n.ts";

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
  { invoiceId, amountCents, lang, onSaved, onCancel }: {
    invoiceId: string;
    /** Invoice total, INTEGER CENTS — prefills the amount field. */
    amountCents?: number;
    lang: Lang;
    onSaved: () => void | Promise<void>;
    onCancel: () => void;
  },
) {
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [dollars, setDollars] = useState(
    amountCents != null ? String(amountCents / 100) : "",
  );
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fieldStyle =
    `width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid ${LINE};border-radius:8px;font:inherit;font-size:13.5px`;
  const labelStyle =
    "display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:var(--fg-muted,#6b7560)";

  async function submit(e: Event) {
    e.preventDefault();
    if (busy) return;
    if (!method) {
      setErr(tFor(lang, "invoicesPage.pay.errMethod"));
      return;
    }
    const cents = Math.round(Number(dollars) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setErr(tFor(lang, "invoicesPage.pay.errAmount"));
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await paymentsClient.create({
        invoiceId,
        amount: cents,
        method,
        // Noon local on the picked day, so the date never shifts across a
        // timezone boundary when the backend stores it as an instant.
        receivedAt: new Date(`${date}T12:00:00`).toISOString(),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      await onSaved();
    } catch {
      setErr(tFor(lang, "invoicesPage.pay.errSave"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} data-cy="pay-received-form" style="display:flex;flex-direction:column;gap:10px">
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
            onInput={(e) => setDollars((e.target as HTMLInputElement).value)}
            style={fieldStyle}
          />
        </label>
        <label style={labelStyle}>
          {tFor(lang, "invoicesPage.pay.dateLabel")}
          <input
            type="date"
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
      {err && (
        <div data-cy="pay-received-error" style="font-size:12.5px;font-weight:700;color:var(--pink-700,#d94e4e)">
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
