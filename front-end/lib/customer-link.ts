/**
 * REQ-310 (demo cycle 1, m13 + m32): the customer's link after a send.
 *
 * A sent quote lives for the customer at `/q/:id`. The chat must keep that
 * link one click away after a send (outside the channel menu) and copying
 * it must say what happened — "copied", or "couldn't copy, here it is" —
 * never a silent catch.
 */

/** Where the customer reads the quote. */
export function customerLinkPath(quoteId: string): string {
  return `/q/${quoteId}`;
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
export function customerLinkUrl(origin: string, quoteId: string): string {
  return `${origin}${customerLinkPath(quoteId)}`;
}

/** Outcome of a copy attempt — what the toast shows. */
export type LinkToast = { kind: "copied" | "failed"; url: string };

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

/** The parts of a chat message the owner pick reads. */
type LinkMessage = {
  id: string;
  kind?: string;
  payload?: unknown;
};

/**
 * REQ-571 (demo-loop cycle 4, p4-p2c): ONE customer-link row per quote.
 * After a send the send divider (REQ-310) and the sent action card (REQ-310 /
 * REQ-460) both carried a row for the same quote — two identical "Open as
 * customer" links. Walk the rendered messages in order and give each quote's
 * row to the NEWEST message that would show it; returns those message ids.
 * `cardShows` is the card's own gate (cardShowsCustomerLink, fed the live
 * quote row where the caller has it).
 */
export function customerLinkOwnerIds<P extends { quoteId?: string }>(
  messages: readonly LinkMessage[],
  cardShows: (payload: P) => boolean,
): Set<string> {
  const owner = new Map<string, string>();
  for (const m of messages) {
    const p = (m.payload ?? {}) as P & Record<string, unknown>;
    if (!p.quoteId) continue;
    const shows = m.kind === "phase_divider"
      ? dividerShowsCustomerLink(p)
      : m.kind === "action_card"
      ? cardShows(p)
      : false;
    if (shows) owner.set(p.quoteId, m.id);
  }
  return new Set(owner.values());
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
