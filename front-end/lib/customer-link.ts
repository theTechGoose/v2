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
