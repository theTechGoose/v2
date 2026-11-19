/**
 * REQ-1031 (LOOP-007 q2-8; amends REQ-924(d)) — the customer page's Remind.
 *
 * Remind used to open the first-send sheet (InvoiceSendDialog) and re-send
 * the invoice email word for word. It now confirms the invoice's reminder
 * NUDGE (REQ-021 / REQ-477 / REQ-704), the same one the /invoices card's
 * "Send a nudge" sends: the backend's reminder preview for today's step
 * (/api/cron/reminder-preview, sent to nobody), a claimed invoice's ask
 * (REQ-250), then Send → lib/invoice-nudge.ts sendInvoiceNudge →
 * POST /api/cron/invoice-reminder. Never /api/invoices/:id/email|text.
 *
 * Drawn in the house send-sheet shape (send-dialog / send-cancel /
 * send-keep) so it reads, and is driven, like every other send.
 */
import { useEffect, useState } from "preact/hooks";
import Backdrop from "./Backdrop.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";
import {
  nudgeDayFor,
  type NudgePreview,
  previewInvoiceNudge,
} from "../lib/invoice-nudge.ts";

export default function InvoiceNudgeDialog(
  { lang, invoice, customerName, onCancel, onSend }: {
    lang: Lang;
    invoice: { id: string; number: string; dueDate?: string; status?: string };
    customerName?: string;
    onCancel: () => void;
    /** sends the nudge for `day` (the caller owns the request + toast) */
    onSend: (day: ReturnType<typeof nudgeDayFor>) => Promise<void>;
  },
) {
  const day = nudgeDayFor(invoice.dueDate);
  const [preview, setPreview] = useState<NudgePreview | null>(null);
  const [sending, setSending] = useState(false);
  const name = customerName?.trim() ||
    tFor(lang, "invoicesPage.detail.reminders.customerFallback");
  const claimed = invoice.status === "claimed";

  useEffect(() => {
    let alive = true;
    previewInvoiceNudge(invoice.id, day).then((p) => {
      if (alive) setPreview(p);
    });
    return () => {
      alive = false;
    };
  }, [invoice.id, day]);

  async function send() {
    if (sending) return;
    setSending(true);
    try {
      await onSend(day);
    } finally {
      setSending(false);
    }
  }

  return (
    <Backdrop class="send-dialog__backdrop" onClose={onCancel}>
      <div
        class="send-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cws-remind-title"
        data-cy="send-dialog"
        data-remind-day={String(day)}
        onClick={(e) => e.stopPropagation()}
      >
        <h4 id="cws-remind-title" class="send-dialog__title">
          {tFor(lang, "customerWs.remind.title", {
            number: invoice.number,
            name,
          })}
        </h4>
        {claimed
          ? (
            <p class="send-dialog__paper-note" data-cy="cws-remind-claimed">
              {tFor(lang, "customerWs.remind.claimedAsk", { name })}
            </p>
          )
          : null}
        {preview
          ? (
            <div
              class="send-dialog__paper-note"
              data-cy="invoice-nudge-preview"
              data-day={String(day)}
            >
              {preview.escalated
                ? tFor(lang, "invoicesPage.nudge.previewAlertOnly")
                : preview.reason === "no_recipient"
                ? tFor(lang, "invoicesPage.nudge.noRecipient")
                : (
                  <>
                    <strong style="display:block;color:var(--fg)">
                      {tFor(lang, "invoicesPage.nudge.previewTitle", { name })}
                    </strong>
                    <span
                      data-cy="invoice-nudge-preview-text"
                      style="display:block;margin-top:2px;white-space:pre-wrap"
                    >
                      {preview.smsBody}
                    </span>
                  </>
                )}
            </div>
          )
          : null}
        <div class="send-dialog__actions">
          <button
            type="button"
            class="send-dialog__cancel"
            data-cy="send-cancel"
            onClick={onCancel}
          >
            {tFor(lang, "asstChat.send.cancel")}
          </button>
          <button
            type="button"
            class="send-dialog__keep"
            data-cy="send-keep"
            disabled={sending}
            onClick={() => void send()}
          >
            {sending
              ? tFor(lang, "asstChat.preview.sending")
              : claimed
              ? tFor(lang, "invoicesPage.back.nudgeClaimedYes")
              : tFor(lang, "customerWs.remind.send")}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}
