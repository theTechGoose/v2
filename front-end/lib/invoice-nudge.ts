/**
 * REQ-021 / REQ-477 / REQ-704 — the invoice's reminder nudge, shared by the
 * /invoices card's "Send a nudge" and (REQ-1031, LOOP-007 q2-8) the customer
 * page's Remind.
 *
 * A nudge is the reminder CADENCE — POST /api/cron/invoice-reminder with the
 * step `manualReminderDay` picks (-3 before the due date, 0 on it, then
 * 3 / 7 / 14 by how overdue the invoice is) — never the full invoice
 * re-sent through the first-send /api/invoices/:id/email|text.
 */
import {
  type NudgeNote,
  nudgeNote,
  type NudgeReply,
} from "../../shared/documents/delivery-truth.ts";
import {
  manualReminderDay,
  type ReminderDay,
} from "../../shared/quote-flow/reminder-settings.ts";

type FetchFn = typeof fetch;

/** The reminder step a manual nudge sends today. */
export function nudgeDayFor(
  dueDate: string | undefined | null,
  today: string = new Date().toISOString().slice(0, 10),
): ReminderDay {
  return manualReminderDay(dueDate, today);
}

/** Sends the invoice's reminder nudge for `day` and answers what to say:
 *  "Nudge sent", or why nothing went (no recipient, muted, already sent,
 *  failed). Never throws. */
export async function sendInvoiceNudge(
  invoiceId: string,
  day: ReminderDay,
  fetchFn: FetchFn = fetch,
): Promise<NudgeNote> {
  try {
    const res = await fetchFn("/api/cron/invoice-reminder", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invoiceId, day }),
    });
    const body = res.ok
      ? (await res.json().catch(() => ({}))) as NudgeReply
      : null;
    if (!res.ok) await res.body?.cancel().catch(() => {});
    return nudgeNote(body);
  } catch {
    return { tone: "fail", key: "invoicesPage.nudge.failed" };
  }
}

export interface NudgePreview {
  escalated?: boolean;
  smsBody?: string;
  reason?: string;
}

/** The reminder a nudge would send, rendered by the backend and sent to
 *  nobody; null when it can't be read. */
export async function previewInvoiceNudge(
  invoiceId: string,
  day: ReminderDay,
  fetchFn: FetchFn = fetch,
): Promise<NudgePreview | null> {
  try {
    const res = await fetchFn("/api/cron/reminder-preview", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invoiceId, day }),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    return (await res.json()) as NudgePreview;
  } catch {
    return null;
  }
}
