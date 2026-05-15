import { useState } from "preact/hooks";

interface Method {
  method: string;
  handle?: string;
}

interface Props {
  invoiceId: string;
  acceptedMethods: Method[];
  customerName?: string;
}

const TEAL = "#144852";
const GREEN = "#519843";
const INK = "#1c2c30";
const MUTED = "#6b7a7e";
const LINE = "#e3e8e6";
const PINK = "#FF6B6B";
const PINK_DARK = "#d94e4e";

/**
 * PublicInvoiceClaim — customer-side "I'm paying you by X" UI on the
 * public invoice page (/i/:id).
 *
 * Flow:
 *   1. Customer sees the contractor's accepted methods as chip buttons.
 *      Tapping a chip reveals that method's handle/address inline
 *      ("Send to @hans-hansen") and a small reference + name input.
 *   2. Customer hits "I sent it" → POSTs to /api/invoices/:id/claim-payment.
 *      Invoice flips to `claimed` server-side.
 *   3. Local state updates to a "thank you" view so the page doesn't need
 *      a hard refresh.
 *
 * If the contractor hasn't configured any methods, we render a fallback
 * "reach out to coordinate payment" message and a tel/mailto pair.
 */
export default function PublicInvoiceClaim({ invoiceId, acceptedMethods, customerName }: Props) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [reference, setReference] = useState("");
  const [claimedBy, setClaimedBy] = useState(customerName ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  if (acceptedMethods.length === 0) {
    return (
      <section
        data-cy="claim-no-methods"
        style={`margin-top:24px;background:rgba(255,107,107,0.04);border:1px solid rgba(255,107,107,0.20);border-radius:14px;padding:18px 22px;color:${INK};font-size:14px;line-height:1.55`}
      >
        Reach out to your contractor to coordinate payment. Once they confirm receipt, you'll get a receipt by text + email.
      </section>
    );
  }

  if (done) {
    return (
      <section
        data-cy="claim-thanks"
        style={`margin-top:24px;background:rgba(81,152,67,0.08);border:1px solid rgba(81,152,67,0.30);border-radius:14px;padding:20px 24px`}
      >
        <div style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN}`}>Thanks!</div>
        <p style={`margin:8px 0 0;color:${INK};font-size:15px;line-height:1.55`}>
          We let your contractor know. They'll confirm when funds land — we'll text you a receipt then.
        </p>
      </section>
    );
  }

  const selectedMethod = selected
    ? acceptedMethods.find((m) => m.method === selected)
    : undefined;

  async function submit() {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/claim-payment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          method: selected,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(claimedBy.trim() ? { claimedBy: claimedBy.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.reason ?? `Couldn't submit (${res.status})`);
      }
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section style="margin-top:28px" data-cy="claim-form">
      <div style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}>How would you like to pay?</div>
      <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">
        {acceptedMethods.map((m) => {
          const active = m.method === selected;
          return (
            <button
              type="button"
              key={m.method}
              data-cy={`claim-method-${m.method}`}
              onClick={() => setSelected(m.method)}
              style={`appearance:none;cursor:pointer;background:${active ? PINK : "#fff"};color:${active ? "#fff" : INK};border:1px solid ${active ? PINK_DARK : LINE};border-radius:999px;padding:9px 16px;font-size:13.5px;font-weight:700;letter-spacing:.01em`}
            >
              {methodLabel(m.method)}
            </button>
          );
        })}
      </div>

      {selectedMethod
        ? (
          <div
            data-cy="claim-detail"
            style={`margin-top:18px;background:#fff;border:1px solid ${LINE};border-radius:14px;padding:18px 20px`}
          >
            <div style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${TEAL}`}>{methodLabel(selectedMethod.method)}</div>
            <div style={`margin-top:8px;color:${INK};font-size:14.5px;line-height:1.55`}>
              {methodInstructions(selectedMethod)}
            </div>
            <label style="display:block;margin-top:14px">
              <span style={`display:block;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};margin-bottom:4px`}>Reference (optional)</span>
              <input
                type="text"
                value={reference}
                data-cy="claim-reference"
                placeholder={referencePlaceholder(selectedMethod.method)}
                onInput={(e) => setReference((e.currentTarget as HTMLInputElement).value)}
                style={`width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid ${LINE};border-radius:10px;font-size:14px;color:${INK}`}
              />
            </label>
            <label style="display:block;margin-top:10px">
              <span style={`display:block;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};margin-bottom:4px`}>Your name (optional)</span>
              <input
                type="text"
                value={claimedBy}
                data-cy="claim-name"
                placeholder="Your name"
                onInput={(e) => setClaimedBy((e.currentTarget as HTMLInputElement).value)}
                style={`width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid ${LINE};border-radius:10px;font-size:14px;color:${INK}`}
              />
            </label>
            {error
              ? <div style={`margin-top:10px;color:#a83b3b;font-size:13px`}>{error}</div>
              : null}
            <button
              type="button"
              data-cy="claim-submit"
              onClick={submit}
              disabled={submitting}
              style={`margin-top:14px;width:100%;appearance:none;cursor:${submitting ? "wait" : "pointer"};background:${GREEN};color:#fff;border:0;border-radius:12px;padding:14px 18px;font-size:15px;font-weight:800;letter-spacing:.01em;box-shadow:0 8px 18px -6px rgba(81,152,67,0.45)`}
            >
              {submitting ? "Sending…" : "I sent it"}
            </button>
          </div>
        )
        : null}
    </section>
  );
}

function methodLabel(method: string): string {
  switch (method) {
    case "check": return "Check";
    case "venmo": return "Venmo";
    case "zelle": return "Zelle";
    case "cashapp": return "Cash App";
    case "cash": return "Cash";
    case "ach": return "Bank transfer";
    case "other": return "Other";
    default: return method;
  }
}

function methodInstructions(m: Method): string {
  switch (m.method) {
    case "check": return m.handle ? `Make it out and mail to: ${m.handle}` : "Mail the check to your contractor.";
    case "venmo": return m.handle ? `Send to ${m.handle} on Venmo.` : "Send the payment via Venmo to your contractor.";
    case "zelle": return m.handle ? `Send to ${m.handle} on Zelle.` : "Send via Zelle to your contractor.";
    case "cashapp": return m.handle ? `Send to ${m.handle} on Cash App.` : "Send via Cash App to your contractor.";
    case "cash": return "Hand the cash to your contractor on-site. Reply here once it's done so they have a record.";
    case "ach": return "Ask your contractor for ACH routing + account details, then submit the transfer from your bank.";
    case "other": return m.handle ? m.handle : "Coordinate with your contractor directly.";
    default: return "Coordinate with your contractor.";
  }
}

function referencePlaceholder(method: string): string {
  switch (method) {
    case "check": return "Check #1234";
    case "venmo": return "Transaction note (e.g. 'paid 5/12')";
    case "zelle": return "Transaction ID or note";
    case "cashapp": return "Transaction ID or note";
    case "cash": return "When you'll bring it (e.g. 'Friday at 3pm')";
    case "ach": return "Transfer reference";
    case "other": return "Details";
    default: return "";
  }
}
