import { type Lang, t } from "@core/i18n/mod.ts";
import { emailRoot } from "@paperwork/domain/business/email-root/mod.ts"; // REQ-1033
import type { PaymentMethod } from "@paperwork/dto/invoice.ts";
import {
  customerOnDocument,
  docRef,
  docTitle,
  type RenderedCustomer,
  renderWord,
} from "@paperwork/domain/business/doc-render/mod.ts";

/**
 * The payment receipt's words — subject, email body, money — shared by every
 * path that receipts a payment (SendPaymentReceipt, REQ-963). Moved here
 * from ConfirmPayment, which re-exports them.
 */

/** REQ-1071 (q2-60): cents always print, like every invoice email ("$500.00"). */
export function fmtUSD(cents: number): string {
  return `$${
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

/** REQ-204: "Receipt for INV-5000" / "Recibo de INV-5000" — the receipt names the invoice. */
export function renderReceiptSubject(
  invoice: { id: string; number?: string },
  lang: Lang,
): string {
  return renderWord(lang, "receiptFor", { number: docRef(invoice) });
}

export function renderReceiptHtml(opts: {
  /** REQ-204: the bill the receipt is for — named by number, customer as snapshotted */
  invoice: {
    id: string;
    number?: string;
    version?: number;
    status?: string;
    sentAt?: string;
    publishedAt?: string;
    billTo?: RenderedCustomer;
    customerSnapshot?: RenderedCustomer;
  };
  customer?: RenderedCustomer;
  contractor?: { name?: string };
  businessName?: string;
  intent: { method: PaymentMethod; reference?: string };
  amount: number;
  lang: Lang;
  /** REQ-628: the business's logo (or wordmark) heading the receipt */
  logoHtml?: string;
  /** REQ-1071 (q2-60): the invoice total. INTEGER CENTS. */
  totalCents?: number;
  /** REQ-1071: what is still due after this payment. INTEGER CENTS. When
   *  above 0 the receipt says so and links to `payUrl`. */
  balanceCents?: number;
  /** REQ-1071: where the customer pays the balance (the invoice shortlink). */
  payUrl?: string;
  /** REQ-1121 (amends REQ-1054): the customer can pay online (hasOnlinePayWay). false → the
   *  button only views the invoice ("View the invoice →"), never "Pay the balance →" — /i
   *  then says "contact your contractor". */
  payOnline?: boolean;
}): string {
  const { lang } = opts;
  const businessLabel = opts.businessName ?? opts.contractor?.name ??
    t(lang, "paperworkEmail.senderFallback");
  const shown = customerOnDocument(opts.invoice, opts.customer);
  const customerFirst = (shown?.name ?? shown?.businessName)?.trim().split(
    /\s+/,
  )[0];
  const headline = customerFirst
    ? t(lang, "confirmPayment.email.headline", {
      name: escapeHtml(customerFirst),
    })
    : t(lang, "confirmPayment.email.headlineNoName");
  const ref = opts.intent.reference
    ? t(lang, "confirmPayment.email.refSuffix", {
      reference: escapeHtml(opts.intent.reference),
    })
    : "";
  // REQ-1071 (q2-60): a payment that leaves a balance says what is still due
  // and links the customer to pay it.
  const balance = opts.balanceCents ?? 0;
  const balanceHtml = balance > 0
    ? `
    <p data-receipt-balance style="margin:14px 0 0;color:#1c2c30;font-size:15px;line-height:1.55">
      ${
      typeof opts.totalCents === "number" && opts.totalCents > 0
        ? t(lang, "confirmPayment.email.balanceLine", {
          balance: fmtUSD(balance),
          total: fmtUSD(opts.totalCents),
        })
        : t(lang, "confirmPayment.email.balanceLineNoTotal", {
          balance: fmtUSD(balance),
        })
    }
    </p>${
      opts.payUrl
        ? `
    <div style="margin-top:22px">
      <a data-receipt-pay href="${
          escapeHtml(opts.payUrl)
        }" style="display:inline-block;background:#144852;color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:12px 22px;border-radius:12px">${
          t(
            lang,
            opts.payOnline === false
              ? "confirmPayment.email.viewCta"
              : "confirmPayment.email.payCta",
          )
        }</a>
    </div>`
        : ""
    }`
    : "";
  return `${emailRoot(lang)}<body style="margin:0;padding:32px 16px;background:#f7f6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2c30">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:28px 32px;box-shadow:0 8px 32px rgba(20,72,82,0.08)">
    ${
    opts.logoHtml ??
      `<div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#d94e4e">${
        escapeHtml(businessLabel)
      }</div>`
  }
    <div data-doc-ref style="margin-top:10px;font-size:12px;font-weight:800;color:#6b7a7e">${
    escapeHtml(docTitle("invoice", opts.invoice, lang))
  }</div>
    <div style="margin-top:18px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:24px;letter-spacing:-0.02em;color:#144852">${headline}</div>
    <p style="margin:14px 0 0;color:#1c2c30;font-size:15px;line-height:1.55">
      ${
    t(lang, "confirmPayment.email.body", { amount: fmtUSD(opts.amount), ref })
  }
    </p>${balanceHtml}
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
