/**
 * REQ-782 (demo-loop dv1, d10) — Raphael: "Card payments should be a link to a separate portal."
 *
 * On /i/:id, "Pay by card" is the one solid primary: a link that opens, in a new tab, the
 * business's card portal — our card page on THEIR Stripe (`/i/:id/pay`, REQ-213/216's widget)
 * or their own card pay link (a Stripe Payment Link, Square, PayPal checkout) from Settings.
 * Without either, the customer sees no card button (never a dead end) and the business's own
 * preview says how to set it up.
 *
 * REQ-808 — the owner's "set up card payments" hint lands on Settings' card payments section.
 *
 * REQ-803 — the business's own Square: the same button in the same place, an island that asks
 * the server for a Square checkout for the balance and goes there ("Secure checkout by Square").
 */
import { type Lang, tFor } from "../lib/i18n.ts";
import { fmtMoneyExact } from "../lib/format.ts";
import type { CardPayWay } from "../../shared/payments/pay-links.ts";
import { GREEN, INK, MUTED, TEAL } from "./doc-parts.tsx";
import SquareCheckout from "../islands/SquareCheckout.tsx"; // REQ-803

export default function PayByCard(
  { way, lang, amountCents, business, number, internal, invoiceId, version }: {
    way: CardPayWay | null;
    lang: Lang;
    amountCents?: number;
    /** REQ-803 — the Square checkout is asked for this invoice at this version */
    invoiceId?: string;
    version?: number;
    business: string;
    number?: string;
    /** the business's own preview of its invoice */
    internal?: boolean;
  },
) {
  if (!way) {
    if (!internal) return null;
    return (
      <section
        data-cy="pay-by-card-setup"
        style={`margin-top:24px;background:rgba(20,72,82,0.04);border:1px dashed rgba(20,72,82,0.35);border-radius:14px;padding:16px 20px;color:${INK};font-size:14px;line-height:1.55`}
      >
        {tFor(lang, "payByCard.setup")}{" "}
        <a
          href="/settings#card-payments"
          data-cy="pay-by-card-setup-link"
          style={`color:${TEAL};font-weight:700;text-decoration:underline`}
        >
          {tFor(lang, "payByCard.setupLink")}
        </a>
      </section>
    );
  }
  if (way.kind === "square" && invoiceId) {
    return (
      <section data-cy="pay-by-card-wrap" style="margin-top:24px">
        <SquareCheckout
          invoiceId={invoiceId}
          lang={lang}
          amountCents={amountCents}
          version={version}
          business={business}
        />
      </section>
    );
  }
  const amount = typeof amountCents === "number" && amountCents > 0
    ? fmtMoneyExact(amountCents)
    : undefined;
  const note = way.kind !== "link"
    ? tFor(lang, "payByCard.portalNote", { business })
    : amount
    ? tFor(
      lang,
      number ? "payByCard.note" : "payByCard.noteNoNumber",
      { business, host: way.host, amount, number: number ?? "" },
    )
    : tFor(lang, "payByCard.portalNote", { business });
  return (
    <section data-cy="pay-by-card-wrap" style="margin-top:24px">
      <a
        href={way.href}
        target="_blank"
        rel="noopener noreferrer"
        data-cy="pay-by-card"
        data-pay-way={way.kind}
        style={`display:block;box-sizing:border-box;width:100%;text-align:center;background:${GREEN};color:#fff;border:1px solid ${GREEN};border-radius:12px;padding:15px 18px;font-size:16px;font-weight:800;text-decoration:none;letter-spacing:.01em`}
      >
        {amount
          ? tFor(lang, "payByCard.button", { amount })
          : tFor(lang, "payByCard.buttonNoAmount")}
      </a>
      <p
        data-cy="pay-by-card-note"
        style={`margin:8px 2px 0;color:${MUTED};font-size:12.5px;line-height:1.5`}
      >
        {note}
      </p>
    </section>
  );
}
