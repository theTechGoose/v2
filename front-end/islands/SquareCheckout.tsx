/**
 * REQ-803 — "Pay $X by card" for a business that connected its OWN Square: Square takes cards
 * only on its own pages, so the button asks the server for a Square checkout for the invoice's
 * balance (`POST /api/invoices/:id/square/checkout`, made on the business's token) and sends
 * the customer there in this tab. Square sends them back to /i/:id?square=return, where the
 * server reads the order and records the payment. A balance that changed since the page loaded
 * is refused by the server with the current one; the button takes it and says so. Same place
 * and weight as the Stripe button (REQ-782): the one solid primary, a line naming Square.
 */
import { useState } from "preact/hooks";
import { type Lang, tFor } from "../lib/i18n.ts";
import { fmtMoneyExact } from "../lib/format.ts";
import { GREEN, MUTED } from "../components/doc-parts.tsx";

export default function SquareCheckout(
  { invoiceId, lang, amountCents, version, business }: {
    invoiceId: string;
    lang: Lang;
    amountCents?: number;
    version?: number;
    business: string;
  },
) {
  const [amount, setAmount] = useState(amountCents);
  const [ver, setVer] = useState(version);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function go() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/invoices/${encodeURIComponent(invoiceId)}/square/checkout`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            amountCents: amount ?? 0,
            ...(typeof ver === "number" ? { version: ver } : {}),
          }),
        },
      );
      const body = await res.json().catch(() => ({})) as {
        ok?: boolean;
        url?: string;
        reason?: string;
        balanceCents?: number;
        version?: number;
      };
      if (res.ok && body.ok && body.url) {
        location.assign(body.url);
        return; // leaving for Square — keep the button busy
      }
      if (body.reason === "stale_balance") {
        setAmount(body.balanceCents);
        setVer(body.version);
        setMsg(
          tFor(lang, "payByCard.square.stale", {
            amount: fmtMoneyExact(body.balanceCents ?? 0),
          }),
        );
      } else if (body.reason === "already_paid") {
        location.reload();
        return;
      } else {
        setMsg(tFor(lang, "payByCard.square.failed"));
      }
    } catch {
      setMsg(tFor(lang, "payByCard.square.failed"));
    }
    setBusy(false);
  }

  const label = typeof amount === "number" && amount > 0
    ? tFor(lang, "payByCard.button", { amount: fmtMoneyExact(amount) })
    : tFor(lang, "payByCard.buttonNoAmount");
  return (
    <>
      <button
        type="button"
        data-cy="pay-by-card"
        data-pay-way="square"
        aria-busy={busy}
        disabled={busy}
        onClick={go}
        style={`display:block;box-sizing:border-box;width:100%;text-align:center;background:${GREEN};color:#fff;border:1px solid ${GREEN};border-radius:12px;padding:15px 18px;font:inherit;font-size:16px;font-weight:800;letter-spacing:.01em;cursor:${
          busy ? "progress" : "pointer"
        };opacity:${busy ? 0.85 : 1}`}
      >
        {busy ? tFor(lang, "payByCard.square.going") : label}
      </button>
      <p
        data-cy="pay-by-card-note"
        style={`margin:8px 2px 0;color:${MUTED};font-size:12.5px;line-height:1.5`}
      >
        {tFor(lang, "payByCard.square.note", { business })}
      </p>
      {msg
        ? (
          <p
            role="alert"
            data-cy="square-checkout-error"
            style="margin:8px 2px 0;color:#b3261e;font-size:13px;font-weight:600"
          >
            {msg}
          </p>
        )
        : null}
    </>
  );
}
