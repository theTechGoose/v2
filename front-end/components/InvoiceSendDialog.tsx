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
 */
import { SendDialog } from "./QuoteSendDialog.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";
import { dashboardClient } from "../clients/dashboard.ts";
import {
  defaultSendChannel,
  type SendDialogCustomer,
  type SendDialogPick,
} from "../lib/send-dialog.ts";
import { invoiceSheetLang } from "../lib/invoice-send-sheet.ts";
import type { SendPreviewDates } from "../../shared/quote-flow/send-preview.ts";

export default function InvoiceSendDialog(
  { lang, invoice, customer, dates = {}, onCancel, onSend }: {
    lang: Lang;
    invoice: { id: string; number?: string; lang?: string };
    /** what is on file — lib/invoice-send-sheet.ts invoiceSendContact */
    customer: SendDialogCustomer | null;
    /** the dates the send stamps first ("Finish + send" / "Send now") */
    dates?: SendPreviewDates;
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
      onCancel={onCancel}
      onSend={onSend}
    />
  );
}
