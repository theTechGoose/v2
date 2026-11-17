/**
 * REQ-627 — the assistant's invoice flows end at a review step: "Send now",
 * "Save as draft" or "Schedule". This is the pure half: what each choice
 * writes on the invoice. Schedule has the same meaning as the /invoices
 * "Send on" date (REQ-022): status "scheduled" + `scheduledFor`, in the
 * Upcoming track, with the send-day nudge.
 */
export type InvoiceReviewAction = "send" | "draft" | "schedule";

export type ScheduleDateProblem = "missing" | "past" | "today";

/** Why a schedule date is refused, or null when it is a future day. */
export function scheduleDateProblem(
  date: string | undefined,
  today: string,
): ScheduleDateProblem | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "missing";
  if (date < today) return "past";
  // scheduling for today is just "Send now" with extra steps
  if (date === today) return "today";
  return null;
}

export type InvoiceStatusFields =
  | { status: "sent"; issuedDate: string }
  | { status: "draft" }
  | { status: "scheduled"; scheduledFor: string };

/** The invoice fields a review choice writes (create body or PUT patch). */
export function invoiceStatusFields(
  action: InvoiceReviewAction,
  opts: { today: string; scheduledFor?: string },
): InvoiceStatusFields {
  if (action === "send") return { status: "sent", issuedDate: opts.today };
  if (action === "draft") return { status: "draft" };
  const problem = scheduleDateProblem(opts.scheduledFor, opts.today);
  if (problem) throw new Error(`schedule date ${problem}`);
  return { status: "scheduled", scheduledFor: opts.scheduledFor! };
}
