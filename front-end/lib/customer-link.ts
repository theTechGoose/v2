/**
 * REQ-310 (demo cycle 1, m13 + m32): the customer's link after a send.
 *
 * A sent quote lives for the customer at `/q/:id`. The chat must keep that
 * link one click away after a send (outside the channel menu) and copying
 * it must say what happened — "copied", or "couldn't copy, here it is" —
 * never a silent catch.
 */

import { withSendLang } from "../../shared/quote-flow/share-link.ts";

/** Where the customer reads the quote. REQ-586 (demo-loop cycle 4, M11):
 *  with the language the quote went out in (`sendLang` — the send divider's
 *  `lang`, or `quoteSendLang(quote)`) as `?lang=`, so a cookie-less customer
 *  opens it in that language; no language → the bare path. */
export function customerLinkPath(
  quoteId: string,
  sendLang?: string | null,
): string {
  return withSendLang(`/q/${quoteId}`, sendLang);
}

/** REQ-586 (M11): where the customer reads the invoice, in its document
 *  language (`invoice.lang`) when known. */
export function invoiceLinkPath(
  invoiceId: string,
  lang?: string | null,
): string {
  return withSendLang(`/i/${invoiceId}`, lang);
}

/**
 * REQ-472 (demo cycle 3, p8-pair5-c): what the row SHOWS for the link — the
 * document's number ("Q-001") when it is known, otherwise the path cut to
 * its first characters ("/q/e302…"). Never the whole uuid; Copy and Open
 * keep the full link.
 */
export function customerLinkDisplay(
  quoteId: string,
  quoteNumber?: string | null,
): string {
  const number = quoteNumber?.trim();
  if (number) return number;
  const shown = quoteId.length > 8 ? `${quoteId.slice(0, 4)}…` : quoteId;
  return customerLinkPath(shown);
}

/** The absolute link to paste anywhere (WhatsApp, DMs). */
export function customerLinkUrl(
  origin: string,
  quoteId: string,
  sendLang?: string | null,
): string {
  return `${origin}${customerLinkPath(quoteId, sendLang)}`;
}

/** Outcome of a copy attempt — what the toast shows. REQ-572: `markQuoteId`
 *  set → the toast also asks "mark as sent?" for that quote; `marking` while
 *  the PUT runs; `markFailed` when it did not land. */
export type LinkToast = {
  kind: "copied" | "failed";
  url: string;
  markQuoteId?: string;
  marking?: boolean;
  markFailed?: boolean;
};

/**
 * REQ-572 (demo-loop cycle 4, p4-p7c): "Copy link" offers "mark as sent" only
 * for a quote that has not gone out — a draft, locked, ready-to-send or
 * not-delivered quote. Never one a channel delivered, the customer opened,
 * signed or declined, or one already marked shared by link.
 */
export function linkCopyOffersMarkSent(
  q:
    | {
      status?: string | null;
      sentAt?: string | null;
      acceptedAt?: string | null;
      lostAt?: string | null;
      deliveredAt?: string | null;
      lastDelivery?: { emailedTo?: string; textedTo?: string } | null;
      sentVia?: string | null;
    }
    | null
    | undefined,
): boolean {
  if (!q) return false;
  if (q.acceptedAt || q.lostAt || q.deliveredAt || q.sentVia) return false;
  if (q.lastDelivery?.emailedTo || q.lastDelivery?.textedTo) return false;
  const s = (q.status ?? "draft").toLowerCase();
  if (s === "draft" || s === "") return true;
  // LockQuote's legacy "sent" with no delivery: still on the owner's desk
  // when a send was tried and reached nobody, or nothing stamped sentAt.
  if (s === "sent") return Boolean(q.lastDelivery) || !q.sentAt;
  return false;
}

/** REQ-572: the owner's "Mark as sent" — PUT /quotes/:id with this body. */
export const SHARED_BY_LINK_PATCH = Object.freeze({
  status: "sent",
  sentVia: "link",
}) as { readonly status: "sent"; readonly sentVia: "link" };

/**
 * A send divider is one SendQuote wrote: it names its quote and carries a
 * channel or an outcome. Those render the customer-link row; wizard phase
 * dividers do not. A failed send still shows the row — the link is exactly
 * the fallback when the text or the email didn't go through.
 */
export function dividerShowsCustomerLink(
  p:
    | {
      quoteId?: string;
      channel?: string;
      emailedTo?: string;
      textedTo?: string;
      emailFailureReason?: string;
      smsFailureReason?: string;
      [k: string]: unknown;
    }
    | null
    | undefined,
): boolean {
  if (!p?.quoteId) return false;
  return !!(p.channel || p.emailedTo || p.textedTo || p.emailFailureReason ||
    p.smsFailureReason);
}

/** The statuses a quote card carries once its quote went out (lockStatusFor). */
const ISSUED_CARD = new Set(["sent", "viewed", "opened", "accepted", "signed"]);

/**
 * REQ-460 (demo-loop cycle 3, M16): a quote card carries the customer's link
 * only once the quote went out — sent, viewed, signed. A LOCKED quote is still
 * being finished (REQ-234: locking is not sending; the terms wizard is still
 * asking), and its link opened a page the owner signed in person mid-wizard.
 * For this thread's own card the live quote row decides (a send after the
 * card was appended counts); any other card goes by its own status.
 */
export function cardShowsCustomerLink(
  cardStatus: string | null | undefined,
  live?: { status?: string | null; sentAt?: string | null } | null,
): boolean {
  if (live) {
    const s = (live.status ?? "").toLowerCase();
    return Boolean(live.sentAt) || (s !== "" && s !== "draft");
  }
  return ISSUED_CARD.has((cardStatus ?? "").toLowerCase());
}

/**
 * Write the url to the clipboard and report the outcome. Never throws: a
 * missing clipboard (http, headless, denied permission) is a `failed` toast
 * that carries the url so the user can still select it.
 */
export async function copyCustomerLink(
  url: string,
  writeText: ((text: string) => Promise<void>) | undefined =
    typeof navigator !== "undefined" && navigator.clipboard
      ? (t) => navigator.clipboard.writeText(t)
      : undefined,
): Promise<LinkToast> {
  if (!writeText) return { kind: "failed", url };
  try {
    await writeText(url);
    return { kind: "copied", url };
  } catch {
    return { kind: "failed", url };
  }
}
