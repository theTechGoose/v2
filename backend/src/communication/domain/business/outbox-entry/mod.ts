/**
 * REQ-784 (demo-loop cycle dv1, issue d12) — the pure pieces of an outbox
 * entry: the list's line (an email's subject, a text's first line), the
 * customer's name as the document gives it, and the paging that lets a whole
 * email body sit in Deno KV (one value is capped at 64 KiB).
 */

/** The list line's cap, in characters (an ellipsis included). */
export const PREVIEW_MAX = 140;

/** Characters per stored page. V8 serializes a string holding any
 *  non-Latin-1 character (an em dash, an accent, an emoji) at 2 bytes per
 *  UTF-16 unit, so 24 000 units is at most ~48 KB — under KV's 64 KiB value
 *  cap with room for the envelope. */
export const OUTBOX_PAGE_CHARS = 24_000;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** One line, whitespace collapsed, cut to PREVIEW_MAX with an ellipsis —
 *  never in the middle of a surrogate pair. */
function capLine(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= PREVIEW_MAX) return one;
  let end = PREVIEW_MAX - 1;
  if (isHighSurrogate(one.charCodeAt(end - 1))) end--;
  return `${one.slice(0, end).trimEnd()}…`;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** An email's HTML as plain lines: head, styles and scripts dropped, block
 *  tags as line breaks, the common entities decoded. */
function htmlText(html: string): string {
  return html
    .replace(/<(head|style|script)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|h[1-6]|li|tr|table|section|header|footer)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

/** The list's line: an email's subject, else the first non-empty line of
 *  the message (an email's as text, never its raw HTML). */
export function outboxPreview(input: {
  channel: "email" | "text";
  subject?: string;
  body?: string;
}): string {
  const subject = input.subject?.trim();
  if (input.channel === "email" && subject) return capLine(subject);
  const body = input.body ?? "";
  const text = input.channel === "email" ? htmlText(body) : body;
  const first = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return first ? capLine(first) : "";
}

/** Split a body into KV-sized pages; "" is no pages. */
export function splitBody(
  body: string,
  size: number = OUTBOX_PAGE_CHARS,
): string[] {
  const pages: string[] = [];
  let i = 0;
  while (i < body.length) {
    let end = Math.min(i + size, body.length);
    // never cut a surrogate pair (an emoji) in half
    if (end < body.length && isHighSurrogate(body.charCodeAt(end - 1))) end--;
    pages.push(body.slice(i, end));
    i = end;
  }
  return pages;
}

/** The body back from its pages. */
export function joinBody(pages: readonly string[]): string {
  return pages.join("");
}

/** The customer as the document names them: the person, else the business. */
export function customerLabel(
  c: { name?: string | null; businessName?: string | null } | undefined | null,
): string | undefined {
  return c?.name?.trim() || c?.businessName?.trim() || undefined;
}
