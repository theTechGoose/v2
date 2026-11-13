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

/**
 * REQ-334 (demo-loop cycle 1, M25): what the in-chat card's "Re-open" does.
 *  - `unlock`: the quote is locked but never sent — re-open it for real
 *    (ReopenQuote: leave terms, clear lockedAt, back to the draft card).
 *  - `revise`: the quote is already issued — nothing can be un-sent; the
 *    change goes down the revision path (the composer's "Change the quote: ").
 *  - `none`: a draft has nothing to re-open.
 */
export type ReopenAction = "unlock" | "revise" | "none";

export function reopenActionFor(
  status: string | undefined | null,
): ReopenAction {
  const s = (status ?? "").toLowerCase();
  if (s === QUOTE_LOCKED) return "unlock";
  if (ISSUED.has(s)) return "revise";
  return "none";
}

/** The live quote row's lifecycle fields the card's controls read. */
export interface LiveCardQuote {
  status?: string | null;
  acceptedAt?: string | null;
  lostAt?: string | null;
}

/** A quote the customer answered — signed or declined: nothing to re-open. */
const ANSWERED = new Set([
  "accepted",
  "signed",
  "won",
  "lost",
  "declined",
  "void",
]);

/**
 * REQ-563 (demo-loop cycle 4, m3): what a quote card's "Re-open" does, read
 * off the LIVE quote row when the card is this thread's quote — the card's
 * stored status is a snapshot from when it was appended ("locked" forever),
 * and "Reabrir" stayed on a quote the customer had already signed. A signed
 * or declined quote offers none; one that went out since the card goes to
 * revision; with no live row the card's own status decides (REQ-334).
 */
export function cardReopenAction(
  cardStatus: string | undefined | null,
  live?: LiveCardQuote | null,
): ReopenAction {
  // only a locked/issued card ever carries Re-open (a draft card has Lock/Edit)
  if (!isLockedOrIssued(cardStatus)) return "none";
  if (!live) return reopenActionFor(cardStatus);
  if (quoteAnswered(live)) return "none";
  return reopenActionFor((live.status ?? "").toLowerCase() || cardStatus);
}

/** REQ-563: the customer answered the quote — signed or declined. */
export function quoteAnswered(live: LiveCardQuote | null | undefined): boolean {
  if (!live) return false;
  return ANSWERED.has((live.status ?? "").toLowerCase()) ||
    Boolean(live.acceptedAt) || Boolean(live.lostAt);
}

/** REQ-563: the live row for a card — the thread's fetched quote when the
 *  card is that quote's, else none (another quote's card keeps its own). */
export function liveCardQuote<Q extends { id?: string } & LiveCardQuote>(
  card: { quoteId?: string } | null | undefined,
  live: Q | null | undefined,
): Q | undefined {
  return live && card?.quoteId && live.id === card.quoteId ? live : undefined;
}

/** REQ-563: the re-read row says the customer just signed (the chat then
 *  re-reads its transcript for the server's "… signed …" divider). */
export function becameSigned(
  before: LiveCardQuote | null | undefined,
  after: LiveCardQuote | null | undefined,
): boolean {
  const signed = (q: LiveCardQuote | null | undefined) =>
    !!q && (["accepted", "signed", "won"].includes(
      (q.status ?? "").toLowerCase(),
    ) || Boolean(q.acceptedAt));
  return !signed(before) && signed(after);
}
