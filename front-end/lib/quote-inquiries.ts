/**
 * REQ-701 (demo-loop cycle 5, issue M21) — a client's question, from the
 * notice to the answer.
 *
 * Pair 9 clicked "Linda Morales hizo una pregunta" and landed on the quote
 * panel with no question and no reply box. The feed row now opens the
 * panel's "Questions from the client" block (`#questions`), and a reply's
 * outcome is worded by the app, never by the provider's raw reason (cycle 5
 * M23 was a raw English developer error).
 */
import { formatPhoneDisplay } from "../../shared/quote-flow/format-helpers.ts";

/** The quote panel's questions block id — the deep link's hash. */
export const QUESTIONS_ANCHOR = "questions";

/** `/quotes?open=<id>#questions` — the panel, scrolled to the questions. */
export function quoteQuestionsHref(quoteId: string): string {
  return `/quotes?open=${encodeURIComponent(quoteId)}#${QUESTIONS_ANCHOR}`;
}

/** What a feed row knows about the event it reports. */
export interface FeedNotification {
  type?: string;
  titleKey?: string;
  entityType?: string;
  entityId?: string;
}

/** A row raised by POST /quotes/:id/inquiry: its title key, or (rows from
 *  before the key was stored) a "customer_replied" row about a quote. */
export function isInquiryNotification(n: FeedNotification): boolean {
  if (n.titleKey) return n.titleKey === "notify.quote.inquiry";
  return n.type === "customer_replied" && n.entityType === "quote";
}

/** UX-20: where a feed row leads — a client's question to the quote's
 *  questions (REQ-701), any other quote event to its panel, an invoice
 *  event to /invoices. */
export function notificationHref(n: FeedNotification): string | undefined {
  if (n.entityType === "quote" && n.entityId) {
    return isInquiryNotification(n)
      ? quoteQuestionsHref(n.entityId)
      : `/quotes?open=${encodeURIComponent(n.entityId)}`;
  }
  if (n.entityType === "invoice") return "/invoices";
  return undefined;
}

/** POST /quotes/:id/inquiries/:inquiryId/reply's answer, as far as the
 *  panel reads it. */
export interface InquiryReplyOutcomeSource {
  ok: boolean;
  channel?: "text" | "email";
  to?: string;
  failureCode?: string;
  reason?: string;
}

export interface ReplyOutcome {
  ok: boolean;
  /** dictionary key of the line under the reply box */
  key: string;
  vars?: Record<string, string>;
}

/** The line the panel shows after Send: where it went, or why it didn't
 *  (by code — the backend's `reason` is for logs only). */
export function replyOutcome(r: InquiryReplyOutcomeSource): ReplyOutcome {
  if (r.ok) {
    return r.channel === "email"
      ? {
        key: "quotesPage.open.receipt.emailedTo",
        vars: { to: r.to ?? "" },
        ok: true,
      }
      : {
        key: "quotesPage.open.receipt.textedTo",
        vars: { to: formatPhoneDisplay(r.to ?? "") },
        ok: true,
      };
  }
  const fail = (k: string): ReplyOutcome => ({
    ok: false,
    key: `quotesPage.inquiries.fail.${k}`,
  });
  switch (r.failureCode) {
    case "needsName":
      return fail("needsName");
    case "empty":
      return fail("empty");
    case "missing":
      return fail(r.channel === "email" ? "noEmail" : "noPhone");
    case "invalid":
    case "fictional":
    case "notMobile":
    case "optedOut":
      return fail("badPhone");
    default:
      return fail("other");
  }
}
