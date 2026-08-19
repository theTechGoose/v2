import { useState } from "preact/hooks";
import { type Lang, tFor } from "../lib/i18n.ts";

interface Method {
  method: string;
  handle?: string;
}

interface Props {
  invoiceId: string;
  acceptedMethods: Method[];
  customerName?: string;
  /** Outgoing-comms language (roadmap p.13). Customer-facing. */
  lang?: "en" | "es";
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
export default function PublicInvoiceClaim(
  { invoiceId, acceptedMethods, customerName, lang = "en" }: Props,
) {
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
        {tFor(lang, "publicInvoiceClaim.noMethods")}
      </section>
    );
  }

  if (done) {
    return (
      <section
        data-cy="claim-thanks"
        style={`margin-top:24px;background:rgba(81,152,67,0.08);border:1px solid rgba(81,152,67,0.30);border-radius:14px;padding:20px 24px`}
      >
        <div
          style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN}`}
        >
          {tFor(lang, "publicInvoiceClaim.thanksHeading")}
        </div>
        <p
          style={`margin:8px 0 0;color:${INK};font-size:15px;line-height:1.55`}
        >
          {tFor(lang, "publicInvoiceClaim.thanksBody")}
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
        throw new Error(
          body.reason ??
            tFor(lang, "publicInvoiceClaim.submitError", {
              status: res.status,
            }),
        );
      }
      setDone(true);
      // UX-35: the SSR chrome OUTSIDE this island must reflect the claim
      // without a manual reload — flip the header badge to the awaiting-
      // confirmation state and retire the "questions before paying?" footer.
      try {
        const pill = document.querySelector<HTMLElement>("[data-status-pill]");
        if (pill) {
          pill.textContent = tFor(
            lang,
            "publicInvoice.status.awaitingConfirmation",
          );
          pill.style.background = "rgba(255,170,40,0.15)";
          pill.style.color = "#a06800";
        }
        const question = document.querySelector<HTMLElement>(
          "[data-invoice-question]",
        );
        if (question) {
          question.textContent = tFor(
            lang,
            "publicInvoice.footer.questionsClaimed",
          );
        }
      } catch { /* decorative — the reload path renders the same states */ }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section style="margin-top:28px" data-cy="claim-form">
      <div
        style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
      >
        {tFor(lang, "publicInvoiceClaim.howToPay")}
      </div>
      <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">
        {acceptedMethods.map((m) => {
          const active = m.method === selected;
          return (
            <button
              type="button"
              key={m.method}
              data-cy={`claim-method-${m.method}`}
              onClick={() => setSelected(m.method)}
              style={`appearance:none;cursor:pointer;background:${
                active ? PINK : "#fff"
              };color:${active ? "#fff" : INK};border:1px solid ${
                active ? PINK_DARK : LINE
              };border-radius:999px;padding:9px 16px;font-size:13.5px;font-weight:700;letter-spacing:.01em`}
            >
              {methodLabel(m.method, lang)}
            </button>
          );
        })}
      </div>

      {selectedMethod
        ? (
          <div
            data-cy="claim-detail"
            data-kbd-group
            style={`margin-top:18px;background:#fff;border:1px solid ${LINE};border-radius:14px;padding:18px 20px`}
          >
            <div
              style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${TEAL}`}
            >
              {methodLabel(selectedMethod.method, lang)}
            </div>
            <div
              style={`margin-top:8px;color:${INK};font-size:14.5px;line-height:1.55`}
            >
              {methodInstructions(selectedMethod, lang)}
            </div>
            <label style="display:block;margin-top:14px">
              <span
                style={`display:block;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};margin-bottom:4px`}
              >
                {tFor(lang, "publicInvoiceClaim.referenceLabel")}
              </span>
              <input
                type="text"
                value={reference}
                data-cy="claim-reference"
                placeholder={referencePlaceholder(selectedMethod.method, lang)}
                onInput={(e) =>
                  setReference((e.currentTarget as HTMLInputElement).value)}
                style={`width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid ${LINE};border-radius:10px;font-size:14px;color:${INK}`}
              />
            </label>
            <label style="display:block;margin-top:10px">
              <span
                style={`display:block;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};margin-bottom:4px`}
              >
                {tFor(lang, "publicInvoiceClaim.nameLabel")}
              </span>
              <input
                type="text"
                value={claimedBy}
                data-cy="claim-name"
                placeholder={tFor(lang, "publicInvoiceClaim.namePlaceholder")}
                onInput={(e) =>
                  setClaimedBy((e.currentTarget as HTMLInputElement).value)}
                style={`width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid ${LINE};border-radius:10px;font-size:14px;color:${INK}`}
              />
            </label>
            {error
              ? (
                <div style={`margin-top:10px;color:#a83b3b;font-size:13px`}>
                  {error}
                </div>
              )
              : null}
            <button
              type="button"
              data-cy="claim-submit"
              onClick={submit}
              disabled={submitting}
              style={`margin-top:14px;width:100%;appearance:none;cursor:${
                submitting ? "wait" : "pointer"
              };background:${GREEN};color:#fff;border:0;border-radius:12px;padding:14px 18px;font-size:15px;font-weight:800;letter-spacing:.01em;box-shadow:0 8px 18px -6px rgba(81,152,67,0.45)`}
            >
              {submitting
                ? tFor(lang, "publicInvoiceClaim.sending")
                : tFor(lang, "publicInvoiceClaim.iSentIt")}
            </button>
          </div>
        )
        : null}
    </section>
  );
}

function methodLabel(method: string, lang: Lang = "en"): string {
  switch (method) {
    case "check":
      return tFor(lang, "paymentMethod.check");
    case "venmo":
      return tFor(lang, "paymentMethod.venmo");
    case "zelle":
      return tFor(lang, "paymentMethod.zelle");
    case "cashapp":
      return tFor(lang, "paymentMethod.cashApp");
    case "paypal":
      return tFor(lang, "paymentMethod.paypal");
    case "cash":
      return tFor(lang, "paymentMethod.cash");
    case "ach":
      return tFor(lang, "paymentMethod.ach");
    case "card":
      return tFor(lang, "paymentMethod.card");
    case "other":
      return tFor(lang, "paymentMethod.other");
    default:
      return method;
  }
}

function methodInstructions(m: Method, lang: Lang = "en"): string {
  const sendTo = (svc: string) =>
    m.handle
      ? tFor(lang, "publicInvoiceClaim.instructions.sendToHandle", {
        handle: m.handle,
        svc,
      })
      : tFor(lang, "publicInvoiceClaim.instructions.sendVia", { svc });
  switch (m.method) {
    case "check":
      return m.handle
        ? tFor(lang, "publicInvoiceClaim.instructions.checkHandle", {
          handle: m.handle,
        })
        : tFor(lang, "publicInvoiceClaim.instructions.check");
    case "venmo":
      return sendTo("Venmo");
    case "zelle":
      return sendTo("Zelle");
    case "cashapp":
      return sendTo("Cash App");
    case "paypal":
      return sendTo("PayPal");
    case "cash":
      return tFor(lang, "publicInvoiceClaim.instructions.cash");
    case "ach":
      return m.handle
        ? m.handle
        : tFor(lang, "publicInvoiceClaim.instructions.ach");
    case "card":
      return m.handle
        ? m.handle
        : tFor(lang, "publicInvoiceClaim.instructions.card");
    case "other":
      return m.handle
        ? m.handle
        : tFor(lang, "publicInvoiceClaim.instructions.other");
    default:
      return tFor(lang, "publicInvoiceClaim.instructions.default");
  }
}

function referencePlaceholder(method: string, lang: Lang = "en"): string {
  switch (method) {
    case "check":
      return tFor(lang, "publicInvoiceClaim.refPlaceholder.check");
    case "venmo":
      return tFor(lang, "publicInvoiceClaim.refPlaceholder.venmo");
    case "zelle":
      return tFor(lang, "publicInvoiceClaim.refPlaceholder.zelle");
    case "cashapp":
      return tFor(lang, "publicInvoiceClaim.refPlaceholder.cashapp");
    case "paypal":
      return tFor(lang, "publicInvoiceClaim.refPlaceholder.paypal");
    case "cash":
      return tFor(lang, "publicInvoiceClaim.refPlaceholder.cash");
    case "ach":
      return tFor(lang, "publicInvoiceClaim.refPlaceholder.ach");
    case "card":
      return tFor(lang, "publicInvoiceClaim.refPlaceholder.card");
    case "other":
      return tFor(lang, "publicInvoiceClaim.refPlaceholder.other");
    default:
      return "";
  }
}
