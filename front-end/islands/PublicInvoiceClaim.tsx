import { useState } from "preact/hooks";
import { type Lang, tFor } from "../lib/i18n.ts";
import { fmtMoneyExact } from "../lib/format.ts";
import {
  claimBody,
  claimDecision,
} from "../../shared/documents/linked-view.ts";
import { type PayButton, payButtons } from "../../shared/payments/pay-links.ts"; // REQ-630

interface Method {
  method: string;
  handle?: string;
  /** REQ-630: a `link` row — the business's own payment link */
  id?: string;
  name?: string;
  url?: string;
}

/** REQ-630: the chip key — a method, or `link-<id>` for each payment link. */
const chipKey = (m: Method) => m.method === "link" ? `link-${m.id}` : m.method;

/** REQ-630: each platform's colour, for the outline + mark of its button. */
const BRAND_COLOR: Record<string, string> = {
  venmo: "#008CFF",
  cashapp: "#00A63A",
  paypal: "#003087",
  zelle: "#6D1ED4",
  link: "#144852",
};

interface Props {
  invoiceId: string;
  acceptedMethods: Method[];
  customerName?: string;
  /** REQ-203: the balance this page shows — the claim is for THIS amount;
   *  a changed balance comes back as 409 stale_balance with the current one. */
  balanceCents?: number;
  /** REQ-203: the version this page shows. */
  version?: number;
  /** Outgoing-comms language (roadmap p.13). Customer-facing. */
  lang?: "en" | "es";
  /** REQ-630: the card (Stripe) is offered above — no "reach out" fallback without methods. */
  hasCard?: boolean;
  /** REQ-630: the invoice number, the note on a Venmo payment. */
  docNumber?: string;
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
  {
    invoiceId,
    acceptedMethods,
    customerName,
    balanceCents,
    version: initialVersion,
    lang = "en",
    hasCard = false,
    docNumber,
  }: Props,
) {
  const [copied, setCopied] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [reference, setReference] = useState("");
  const [claimedBy, setClaimedBy] = useState(customerName ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // REQ-203: the balance + version this island claims against. A 409
  // stale_balance replaces them with the server's current ones and the page
  // re-renders with that balance (the SSR amount block is patched in place).
  const [balance, setBalance] = useState<number | undefined>(balanceCents);
  const [version, setVersion] = useState<number | undefined>(initialVersion);
  const [stale, setStale] = useState(false);
  const [alreadyPaid, setAlreadyPaid] = useState(false);

  if (alreadyPaid) {
    return (
      <section
        data-cy="claim-already-paid"
        style={`margin-top:24px;background:rgba(81,152,67,0.08);border:1px solid rgba(81,152,67,0.30);border-radius:14px;padding:20px 24px`}
      >
        <div
          style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN}`}
        >
          {tFor(lang, "status.paid")}
        </div>
        <p
          style={`margin:8px 0 0;color:${INK};font-size:15px;line-height:1.55`}
        >
          {tFor(lang, "public.doc.alreadyPaid")}
        </p>
      </section>
    );
  }

  if (acceptedMethods.length === 0) {
    // REQ-630: the card above is a way to pay — nothing to add
    if (hasCard) return null;
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
    ? acceptedMethods.find((m) => chipKey(m) === selected)
    : undefined;
  // REQ-630: the app links (amount prefilled), the business's own links, then what is copied
  const buttons = payButtons(acceptedMethods, {
    amountCents: balance,
    note: docNumber,
  });

  function copy(b: PayButton) {
    if (b.kind !== "copy") return;
    const done = () => {
      setCopied(b.key);
      setTimeout(() => setCopied((k) => (k === b.key ? undefined : k)), 2000);
    };
    try {
      navigator.clipboard.writeText(b.value).then(done, done);
    } catch {
      done();
    }
  }

  async function submit() {
    if (!selected || !selectedMethod || submitting) return;
    // REQ-630: a payment link is claimed as "other", its name the reference
    const method = selectedMethod.method === "link"
      ? "other"
      : selectedMethod.method;
    const ref = reference.trim() ||
      (selectedMethod.method === "link" ? selectedMethod.name ?? "" : "");
    setSubmitting(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/claim-payment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(
          typeof balance === "number"
            // REQ-203: claim the balance shown, on the version shown
            ? claimBody({ method, reference: ref, claimedBy }, {
              balanceCents: balance,
              ...(typeof version === "number" ? { version } : {}),
            })
            : {
              method,
              ...(ref ? { reference: ref } : {}),
              ...(claimedBy.trim() ? { claimedBy: claimedBy.trim() } : {}),
            },
        ),
      });
      const body = await res.json().catch(() => ({}));
      const decision = claimDecision(res.status, body);
      if (decision.kind === "stale_balance") {
        // The balance moved under this page: show the current one and let
        // the customer confirm against it. The SSR amount block is patched
        // in place so the whole page agrees.
        setBalance(decision.balanceCents);
        if (typeof decision.version === "number") setVersion(decision.version);
        setStale(true);
        try {
          const amt = document.querySelector<HTMLElement>(
            "[data-cy='invoice-balance-due']",
          );
          if (amt) amt.textContent = fmtMoneyExact(decision.balanceCents);
        } catch { /* decorative — the island's own note carries the balance */ }
        return;
      }
      if (decision.kind === "already_paid") {
        setAlreadyPaid(true);
        try {
          const pill = document.querySelector<HTMLElement>(
            "[data-status-pill]",
          );
          if (pill) {
            pill.textContent = tFor(lang, "status.paid");
            pill.style.background = "rgba(81,152,67,0.15)";
            pill.style.color = GREEN;
          }
        } catch { /* decorative */ }
        return;
      }
      if (decision.kind === "error") {
        throw new Error(
          decision.reason === String(res.status)
            ? tFor(lang, "publicInvoiceClaim.submitError", {
              status: res.status,
            })
            : decision.reason,
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
      {stale && typeof balance === "number"
        ? (
          <div
            data-cy="claim-stale-balance"
            role="status"
            style="margin-bottom:12px;background:#fff6e5;border:1px solid rgba(255,170,40,0.35);border-radius:12px;padding:12px 14px;color:#8a5a10;font-weight:700;font-size:13.5px"
          >
            {tFor(lang, "public.doc.staleBalance", {
              amount: fmtMoneyExact(balance),
            })}
          </div>
        )
        : null}
      {buttons.length > 0
        ? (
          <div data-cy="pay-buttons" style="margin-bottom:22px">
            <div
              style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
            >
              {tFor(lang, "payLinks.page.heading")}
            </div>
            <div style="margin-top:12px;display:grid;gap:10px">
              {buttons.map((b) => {
                const color = BRAND_COLOR[b.method] ?? TEAL;
                const mark = (
                  <span
                    aria-hidden="true"
                    style={`flex:none;width:32px;height:32px;border-radius:9px;background:${color};color:#fff;display:grid;place-items:center;font-weight:900;font-size:15px`}
                  >
                    {b.label.trim().charAt(0).toUpperCase()}
                  </span>
                );
                if (b.kind === "link") {
                  const label = b.method === "link" ||
                      typeof balance !== "number"
                    ? tFor(lang, "payLinks.page.payWith", { brand: b.label })
                    : tFor(lang, "payLinks.page.amountWith", {
                      amount: fmtMoneyExact(balance),
                      brand: b.label,
                    });
                  return (
                    <a
                      key={b.key}
                      data-cy={`pay-${b.key}`}
                      href={b.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={`display:flex;align-items:center;gap:12px;min-height:52px;box-sizing:border-box;padding:10px 14px;background:#fff;border:1.5px solid ${color};border-radius:12px;color:${INK};text-decoration:none`}
                    >
                      {mark}
                      <span style="flex:1;min-width:0;display:grid">
                        <span style="font-weight:800;font-size:15px;line-height:1.25;overflow-wrap:anywhere">
                          {label}
                        </span>
                        {b.detail
                          ? (
                            <span
                              style={`font-size:12.5px;color:${MUTED};overflow:hidden;text-overflow:ellipsis;white-space:nowrap`}
                            >
                              {b.detail}
                            </span>
                          )
                          : null}
                      </span>
                      <span
                        aria-hidden="true"
                        style={`flex:none;color:${color};font-weight:900;font-size:18px`}
                      >
                        ↗
                      </span>
                    </a>
                  );
                }
                return (
                  <div
                    key={b.key}
                    data-cy={`pay-${b.key}`}
                    style={`display:flex;align-items:center;gap:12px;min-height:52px;box-sizing:border-box;padding:10px 14px;background:#fff;border:1.5px solid ${color};border-radius:12px;color:${INK}`}
                  >
                    {mark}
                    <span style="flex:1;min-width:0;display:grid">
                      <span style="font-weight:800;font-size:15px;line-height:1.25">
                        {b.label}
                      </span>
                      <span
                        data-cy={`pay-${b.key}-value`}
                        style={`font-size:13px;color:${INK};overflow-wrap:anywhere`}
                      >
                        {tFor(lang, "payLinks.page.sendTo", {
                          handle: b.value,
                        })}
                      </span>
                    </span>
                    <button
                      type="button"
                      data-cy={`pay-${b.key}-copy`}
                      onClick={() => copy(b)}
                      style={`flex:none;appearance:none;cursor:pointer;background:#fff;color:${color};border:1px solid ${color};border-radius:999px;padding:7px 14px;font-size:13px;font-weight:800`}
                    >
                      {copied === b.key
                        ? tFor(lang, "payLinks.page.copied")
                        : tFor(lang, "payLinks.page.copy")}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )
        : null}
      <div
        style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
      >
        {buttons.length > 0
          ? tFor(lang, "payLinks.page.alreadyPaid")
          : tFor(lang, "publicInvoiceClaim.howToPay")}
        {typeof balance === "number"
          ? (
            <span
              data-cy="claim-balance"
              style={`margin-left:8px;color:${TEAL};letter-spacing:0;text-transform:none;font-size:12px`}
            >
              {fmtMoneyExact(balance)}
            </span>
          )
          : null}
      </div>
      <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">
        {acceptedMethods.map((m) => {
          const key = chipKey(m);
          const active = key === selected;
          return (
            <button
              type="button"
              key={key}
              data-cy={`claim-method-${key}`}
              onClick={() => setSelected(key)}
              style={`appearance:none;cursor:pointer;background:${
                active ? PINK : "#fff"
              };color:${active ? "#fff" : INK};border:1px solid ${
                active ? PINK_DARK : LINE
              };border-radius:999px;padding:9px 16px;font-size:13.5px;font-weight:700;letter-spacing:.01em`}
            >
              {m.method === "link" ? m.name : methodLabel(m.method, lang)}
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
              {selectedMethod.method === "link"
                ? selectedMethod.name
                : methodLabel(selectedMethod.method, lang)}
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
    case "link":
      return tFor(lang, "payLinks.page.claimLink", { name: m.name ?? "" });
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
    case "link":
      return tFor(lang, "publicInvoiceClaim.refPlaceholder.other");
    default:
      return "";
  }
}
