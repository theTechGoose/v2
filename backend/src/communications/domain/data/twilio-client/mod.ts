/**
 * REQ-899 — the line's Twilio REST client (Messages). Same shape as the OTP
 * `SmsService`: a `fetchOverride` test seam, dev mode when no account SID,
 * Twilio's error code surfaced on a rejection. Reads `COMMS_*`, never `TWILIO_*`.
 */
import { Injectable } from "#danet/core";
import { CommsConfigSource } from "@communications/domain/data/config/mod.ts";

export interface SendMessageInput {
  to: string;
  body: string;
  /** our status-callback URL, so delivery state flows back (REQ-899) */
  statusCallback?: string;
}

export interface SendMessageResult {
  ok: boolean;
  sid?: string;
  status?: string;
  /** "dev_mode_no_dispatch" | "not_configured" | a Twilio message | an error message */
  reason?: string;
  code?: number;
}

@Injectable()
export class TwilioClient {
  fetchOverride: typeof fetch | null = null;

  constructor(private cfgSource: CommsConfigSource) {}

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const cfg = this.cfgSource.get();
    if (cfg.devMode) {
      console.log(`[communications:dev-mode] would text to=${input.to} body="${input.body}"`);
      return { ok: true, reason: "dev_mode_no_dispatch", status: "dev" };
    }
    if (!cfg.authToken || !cfg.from) return { ok: false, reason: "not_configured" };
    const f = this.fetchOverride ?? globalThis.fetch;
    const form = new URLSearchParams();
    form.set("To", input.to);
    form.set("From", cfg.from);
    form.set("Body", input.body);
    if (input.statusCallback) form.set("StatusCallback", input.statusCallback);
    try {
      const res = await f(`${cfg.baseUrl}/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(`${cfg.accountSid}:${cfg.authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: form.toString(),
      });
      const text = await res.text();
      let parsed: { sid?: string; status?: string; code?: number; message?: string } = {};
      try {
        parsed = JSON.parse(text);
      } catch { /* non-JSON error page */ }
      if (!res.ok) {
        return { ok: false, reason: parsed.message ?? `twilio ${res.status}: ${text.slice(0, 200)}`, ...(typeof parsed.code === "number" ? { code: parsed.code } : {}) };
      }
      return { ok: true, sid: parsed.sid, status: parsed.status };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }
}
