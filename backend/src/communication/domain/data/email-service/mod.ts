import { Injectable } from "#danet/core";
import { encodeBase64 } from "#std/encoding/base64";
import { fromDocumonster, HOUSE_FROM, SEND_DOMAIN } from "@communication/domain/business/sender/mod.ts";

export interface EmailAttachment {
  /** Filename the recipient sees (e.g., "Agreement-1A0AE6B6.pdf"). */
  name: string;
  /** Raw bytes; will be base64-encoded into the Postmark payload. */
  content: Uint8Array;
  /** MIME type — e.g., "application/pdf", "image/png". */
  contentType: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  htmlBody: string;
  /** Optional From — a contractor's alias at documonster.com (REQ-123); otherwise the house From. */
  from?: string;
  /** Optional CC list — Postmark accepts a comma-separated string. */
  cc?: string[];
  /** File attachments — Postmark base64-encodes them; we accept raw bytes. */
  attachments?: EmailAttachment[];
}

export interface SendEmailResult {
  ok: boolean;
  /** Postmark MessageID, when the dispatch happened. */
  messageId?: string;
  /** Reason if the send failed (or 'dev_mode_no_dispatch'). */
  reason?: string;
}

/** Postmark's /email request body (the fields this app sends). */
export interface PostmarkPayload {
  From: string;
  To: string;
  Cc?: string;
  Subject: string;
  HtmlBody: string;
  MessageStream: "outbound";
  Attachments?: { Name: string; Content: string; ContentType: string }[];
}

/** REQ-123 — the request Postmark gets: a send with no From leaves from the house address. Pure. */
export function postmarkPayload(input: SendEmailInput): PostmarkPayload {
  return {
    From: input.from ?? HOUSE_FROM,
    To: input.to,
    ...(input.cc?.length ? { Cc: input.cc.join(", ") } : {}),
    Subject: input.subject,
    HtmlBody: input.htmlBody,
    MessageStream: "outbound",
    ...(input.attachments?.length
      ? {
        Attachments: input.attachments.map((a) => ({
          Name: a.name,
          Content: encodeBase64(a.content),
          ContentType: a.contentType,
        })),
      }
      : {}),
  };
}

/**
 * EmailService — thin wrapper over Postmark's transactional API.
 *
 * Configuration:
 *   - POSTMARK_API_KEY       (required for production)
 *   - POSTMARK_BASE_URL      (defaults to https://api.postmarkapp.com)
 *
 * The From is never configuration (REQ-123): the house From, or the alias a
 * coordinator passes — on documonster.com, or the send is refused.
 *
 * If POSTMARK_API_KEY is not set, the service operates in **dev mode**:
 *   - logs the email to stdout
 *   - returns `{ ok: true, reason: 'dev_mode_no_dispatch' }`
 * so local development + CI never accidentally send real email.
 *
 * Tests pass a custom `fetch` (or set POSTMARK_BASE_URL to a mock server)
 * to avoid hitting the real Postmark API.
 */
@Injectable()
export class EmailService {
  /**
   * Test seam: smoke tests assign a mock fetch here so the SDK call is
   * intercepted. Production leaves it null and EmailService uses
   * globalThis.fetch. Cannot be a constructor arg because Danet's DI
   * can't resolve plain-object params.
   */
  fetchOverride: typeof fetch | null = null;

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const payload = postmarkPayload(input);
    if (!fromDocumonster(payload.From)) {
      return {
        ok: false,
        reason: `from ${payload.From} is not on ${SEND_DOMAIN}; every email leaves from ${SEND_DOMAIN} (REQ-123)`,
      };
    }

    const apiKey = Deno.env.get("POSTMARK_API_KEY");
    if (!apiKey) {
      const attachLog = input.attachments?.length
        ? ` attachments=[${
          input.attachments.map((a) =>
            `${a.name} (${a.contentType}, ${a.content.byteLength}B)`
          ).join(", ")
        }]`
        : "";
      console.log(
        `[email:dev-mode] would send from=${payload.From} to=${input.to} subject="${input.subject}"${attachLog}`,
      );
      return { ok: true, reason: "dev_mode_no_dispatch" };
    }

    const baseUrl = Deno.env.get("POSTMARK_BASE_URL") ??
      "https://api.postmarkapp.com";
    const f = this.fetchOverride ?? globalThis.fetch;

    try {
      const res = await f(`${baseUrl}/email`, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": apiKey,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // Drain the body so the response doesn't leak in tests.
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          reason: `postmark ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      const body = await res.json() as { MessageID?: string };
      return { ok: true, messageId: body.MessageID };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }
}
