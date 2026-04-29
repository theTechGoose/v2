import { Injectable } from "#danet/core";

export interface SendSmsInput {
  to:   string;     // E.164
  body: string;
}

export interface SendSmsResult {
  ok:        boolean;
  /** Twilio message SID, when the dispatch happened. */
  sid?:      string;
  /** Reason if it failed (or 'dev_mode_no_dispatch'). */
  reason?:   string;
}

/**
 * SmsService — Twilio Messages API wrapper.
 *
 * Configuration:
 *   - TWILIO_ACCOUNT_SID   (required for production)
 *   - TWILIO_AUTH_TOKEN    (required for production)
 *   - TWILIO_FROM          (required for production; the verified Twilio number, E.164)
 *   - TWILIO_BASE_URL      (defaults to https://api.twilio.com)
 *
 * If TWILIO_ACCOUNT_SID is not set, the service operates in **dev mode**:
 *   - logs the SMS to stdout (so you can read OTP codes during local dev)
 *   - returns `{ ok: true, reason: 'dev_mode_no_dispatch' }`
 *
 * Tests assign `fetchOverride` so smoke tests verify the wire format
 * without hitting the real Twilio API.
 *
 * Same shape as EmailService — same test seam, same dev-mode fallback,
 * same reason-string contract.
 */
@Injectable()
export class SmsService {
  /** Test seam: smoke tests assign a mock fetch here. */
  fetchOverride: typeof fetch | null = null;

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    const sid       = Deno.env.get("TWILIO_ACCOUNT_SID");
    const token     = Deno.env.get("TWILIO_AUTH_TOKEN");
    const from      = Deno.env.get("TWILIO_FROM");

    if (!sid) {
      console.log(`[sms:dev-mode] would send to=${input.to} body="${input.body}"`);
      return { ok: true, reason: "dev_mode_no_dispatch" };
    }
    if (!token) return { ok: false, reason: "TWILIO_AUTH_TOKEN not set" };
    if (!from)  return { ok: false, reason: "TWILIO_FROM not set" };

    const baseUrl = Deno.env.get("TWILIO_BASE_URL") ?? "https://api.twilio.com";
    const f = this.fetchOverride ?? globalThis.fetch;

    // Twilio's create-message endpoint takes form-urlencoded.
    const form = new URLSearchParams();
    form.set("To",   input.to);
    form.set("From", from);
    form.set("Body", input.body);

    try {
      const res = await f(`${baseUrl}/2010-04-01/Accounts/${sid}/Messages.json`, {
        method:  "POST",
        headers: {
          // HTTP Basic auth — Twilio standard.
          "Authorization": `Basic ${btoa(`${sid}:${token}`)}`,
          "Content-Type":  "application/x-www-form-urlencoded",
          "Accept":        "application/json",
        },
        body: form.toString(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, reason: `twilio ${res.status}: ${text.slice(0, 200)}` };
      }
      const body = await res.json() as { sid?: string };
      return { ok: true, sid: body.sid };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }
}
