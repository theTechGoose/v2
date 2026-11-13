/**
 * REQ-727 (demo-loop cycle 5, c4-M16 / m56) — the /invoices send sheet.
 *
 * "Issue invoice", "Finish + send" and "Send now" used to send the invoice
 * over email AND text the moment they were pressed. They now open this
 * sheet: the quote's send dialog (SendDialog, on lib/send-dialog.ts's
 * rules) for the invoice — "How do you want to send INV-001 to Juan
 * Perez?", Text + Email / Text / Email (Recommended and "needs an email"
 * from what is on file, a missing contact asked for inline), "Sends in"
 * starting on the invoice's own language, and "What they'll get" from GET
 * /invoices/:id/send-preview with the dates the send will stamp. Nothing is
 * sent until Send; `onSend` gets the pick.
 *
 * REQ-776 (demo-loop cycle dv1, d3) — Raphael: "Finish and send should have
 * a review step." Under the title the sheet reviews what is about to go
 * out: the amount, the line items, who it goes to and the due date; the
 * channel(s) are the picker below. Cancel sends nothing.
 */
import { SendDialog } from "./QuoteSendDialog.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";
import { dashboardClient } from "../clients/dashboard.ts";
import {
  defaultSendChannel,
  type SendDialogCustomer,
  type SendDialogPick,
} from "../lib/send-dialog.ts";
import {
  type InvoiceSendReview,
  invoiceSheetLang,
} from "../lib/invoice-send-sheet.ts";
import { fmtMoneyExact, fmtPhone } from "../lib/format.ts";
import type { SendPreviewDates } from "../../shared/quote-flow/send-preview.ts";

export default function InvoiceSendDialog(
  { lang, invoice, customer, dates = {}, review, onCancel, onSend }: {
    lang: Lang;
    invoice: { id: string; number?: string; lang?: string };
    /** what is on file — lib/invoice-send-sheet.ts invoiceSendContact */
    customer: SendDialogCustomer | null;
    /** the dates the send stamps first ("Finish + send" / "Send now") */
    dates?: SendPreviewDates;
    /** REQ-776: what is being sent — lib/invoice-send-sheet.ts
     *  invoiceSendReview */
    review?: InvoiceSendReview;
    onCancel: () => void;
    onSend: (pick: SendDialogPick) => Promise<void>;
  },
) {
  const number = invoice.number?.trim() ||
    tFor(lang, "invoicesPage.send.invoiceFallback");
  const name = customer?.name?.trim();
  const onFile = {
    email: customer?.email ?? undefined,
    phoneNumber: customer?.phoneNumber ?? undefined,
  };
  return (
    <SendDialog
      lang={lang}
      title={name
        ? tFor(lang, "invoicesPage.send.sheetTitle", { number, name })
        : tFor(lang, "invoicesPage.send.sheetTitleNoName", { number })}
      customer={customer}
      initialChannel={defaultSendChannel(onFile)}
      initialSendLang={invoiceSheetLang(invoice)}
      loadDefaultLang={() =>
        dashboardClient.invoiceSendPreview(
          invoice.id,
          "email",
          undefined,
          dates,
        )
          .then((p) => p.lang)}
      loadPreview={(ch, l) =>
        dashboardClient.invoiceSendPreview(invoice.id, ch, l, dates)}
      previewKey={`${invoice.id}:${dates.issuedDate ?? ""}:${
        dates.dueDate ?? ""
      }`}
      errorKey="invoicesPage.send.sheetError"
      summary={review
        ? <SendReview lang={lang} review={review} customer={customer} />
        : null}
      onCancel={onCancel}
      onSend={onSend}
    />
  );
}

/** "Nov 28, 2026" / "28 nov 2026" — a yyyy-mm-dd calendar date. */
function reviewDate(iso: string, lang: Lang): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** REQ-776: the review — amount, line items, recipient, due date. */
function SendReview(
  { lang, review, customer }: {
    lang: Lang;
    review: InvoiceSendReview;
    customer: SendDialogCustomer | null;
  },
) {
  const to = [
    customer?.name?.trim(),
    customer?.email?.trim(),
    customer?.phoneNumber?.trim() ? fmtPhone(customer.phoneNumber) : "",
  ].filter(Boolean);
  const hasContact = !!(customer?.email?.trim() ||
    customer?.phoneNumber?.trim());
  return (
    <dl class="send-review" data-cy="send-review">
      <div class="send-review__row" data-cy="send-review-amount">
        <dt>{tFor(lang, "invoicesPage.send.reviewAmount")}</dt>
        <dd class="send-review__amount">
          {fmtMoneyExact(review.totalCents)}
        </dd>
      </div>
      {review.lines.length > 0
        ? (
          <div class="send-review__row" data-cy="send-review-items">
            <dt>{tFor(lang, "invoicesPage.send.reviewItems")}</dt>
            <dd>
              <ul class="send-review__lines">
                {review.lines.map((l, i) => (
                  <li key={i} data-cy="send-review-line">
                    <span>{l.quantity} × {l.description}</span>
                    <span>{fmtMoneyExact(l.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )
        : null}
      <div class="send-review__row" data-cy="send-review-to">
        <dt>{tFor(lang, "invoicesPage.send.reviewTo")}</dt>
        <dd>
          {to.join(" · ")}
          {hasContact ? null : (
            <>
              {to.length ? " · " : ""}
              {tFor(lang, "invoicesPage.send.reviewNoContact")}
            </>
          )}
        </dd>
      </div>
      <div class="send-review__row" data-cy="send-review-due">
        <dt>{tFor(lang, "invoicesPage.send.reviewDue")}</dt>
        <dd>
          {review.dueDate
            ? reviewDate(review.dueDate, lang)
            : tFor(lang, "invoicesPage.send.reviewNoDue")}
        </dd>
      </div>
    </dl>
  );
}
