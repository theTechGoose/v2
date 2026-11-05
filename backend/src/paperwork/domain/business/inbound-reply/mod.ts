/**
 * REQ-175 — a customer's reply to a paperwork email lands in the contractor's
 * Messages, in that customer's thread. The outgoing email's Reply-To is
 * reply+<token>@<inbound domain>; Postmark posts the reply to the inbound
 * webhook, which reads the token back from the recipient. Pure.
 */

export const DEFAULT_INBOUND_DOMAIN = "inbound.documonster.com";

export function inboundDomain(): string {
  return Deno.env.get("INBOUND_MAIL_DOMAIN")?.trim() || DEFAULT_INBOUND_DOMAIN;
}

export function replyAddress(token: string, domain: string): string {
  return `reply+${token}@${domain}`;
}

/** the token out of a recipient header — a bare address, a display-name form, or a list */
export function replyTokenOf(
  recipient: string | undefined | null,
): string | undefined {
  if (!recipient) return undefined;
  const m = /reply\+([A-Za-z0-9_-]+)@/.exec(recipient);
  return m ? m[1] : undefined;
}

export interface InboundReply {
  token?: string;
  from?: string;
  fromName?: string;
  subject?: string;
  text: string;
  messageId?: string;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** Postmark's inbound JSON → what the thread needs */
export function parseInboundReply(body: unknown): InboundReply {
  const b = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  const toFull = Array.isArray(b.ToFull)
    ? b.ToFull as { Email?: string }[]
    : [];
  const ccFull = Array.isArray(b.CcFull)
    ? b.CcFull as { Email?: string }[]
    : [];
  const candidates = [
    str(b.OriginalRecipient),
    str(b.To),
    ...toFull.map((x) => x.Email),
    str(b.Cc),
    ...ccFull.map((x) => x.Email),
  ];
  let token: string | undefined;
  for (const c of candidates) {
    token = replyTokenOf(c);
    if (token) break;
  }
  const text = str(b.StrippedTextReply) ?? str(b.TextBody) ??
    stripHtml(str(b.HtmlBody) ?? "");
  return {
    token,
    from: str(b.From)?.replace(/^.*<([^>]+)>.*$/, "$1"),
    fromName: str(b.FromName),
    subject: str(b.Subject),
    text,
    messageId: str(b.MessageID),
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
