/**
 * REQ-234 (demo M3) — locking a quote is NOT sending it.
 *
 * "Lock it in" / "Confirmar" freezes the price so the chat can move on to
 * the terms wizard and the customer step. The quote stays a `draft` (it
 * gets a `lockedAt` stamp); only Send (SendQuote) flips it to `sent`,
 * stamps `sentAt` and dispatches the email/SMS. The chat's action card and
 * the conversation carry the pseudo-status `locked` so the UI can say
 * "Locked · ready to send" instead of "Sent".
 */

/** Card / conversation status of a quote that is locked but not sent. */
export const QUOTE_LOCKED = "locked";

const ISSUED = new Set(["sent", "viewed", "opened", "accepted", "signed"]);

/**
 * The status the locked action card (and conv.quoteStatus) should carry.
 * A quote already issued keeps its real status — re-locking never demotes.
 */
export function lockStatusFor(
  quote: { status?: string | null; sentAt?: string | null },
): string {
  const s = (quote.status ?? "").toLowerCase();
  if (ISSUED.has(s)) return s;
  if (quote.sentAt) return "sent";
  return QUOTE_LOCKED;
}

/** The i18n key for the in-chat quote card's status chip. */
export function cardChipKey(status: string | undefined | null): string {
  switch ((status ?? "draft").toLowerCase()) {
    case QUOTE_LOCKED:
      return "asstChat.statusChip.locked";
    case "sent":
      return "status.sent";
    case "opened":
    case "viewed":
      return "status.viewed";
    case "won":
    case "accepted":
    case "signed":
      return "asstChat.statusChip.approved";
    case "void":
    case "declined":
    case "lost":
      return "status.declined";
    default:
      return "status.draft";
  }
}

/** True for a card past the draft stage: locked, or already issued. */
export function isLockedOrIssued(status: string | undefined | null): boolean {
  return status === QUOTE_LOCKED || status === "sent";
}
