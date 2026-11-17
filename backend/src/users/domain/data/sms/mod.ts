import { Injectable } from "#danet/core";
import type { SmsFailureCode } from "#quote-flow/sms-failure.ts";
import { smsTarget } from "@users/domain/business/normalize-phone/mod.ts";

export interface SendSmsInput {
  to: string; // E.164
  body: string;
}

export interface SendSmsResult {
  ok: boolean;
  /** Twilio message SID, when the dispatch happened. */
  sid?: string;
  /** Reason if it failed (or 'dev_mode_no_dispatch'). REQ-030 (NW-25): a
   *  recognised Twilio rejection is a lang key (sms.invalidNumber /
   *  sms.optedOut / sms.notMobile) the send surfaces translate. */
  reason?: string;
  /** Twilio error code, when the provider rejected the message. */
  code?: number;
  /** The provider's raw error text — for logs, never for the contractor. */
  detail?: string;
  /** REQ-523: why the text didn't go out, as a code — set when the number
   *  was refused before the provider (missing / invalid / fictional) or the
   *  provider rejected it with a recognised code. */
  failureCode?: SmsFailureCode;
}

/** REQ-030: Twilio error codes that mean "this number can't take this text",
 *  each mapped to dictionary copy. */
const TWILIO_REASON_KEYS: Record<number, string> = {
  21211: "sms.invalidNumber",
  21610: "sms.optedOut",
  21614: "sms.notMobile",
};
const TWILIO_FAILURE_CODES: Record<number, SmsFailureCode> = {
  21211: "invalid",
  21610: "optedOut",
  21614: "notMobile",
};

/**
 * SmsService — Twilio Messages API wrapper.
 *
 * Configuration:
 *   - TWILIO_ACCOUNT_SID   (required for production)
 *   - TWILIO_AUTH_TOKEN    (required for production)
 *   - TWILIO_FROM          (required for production; the verified Twilio number, E.164).
 *                          MUST also be registered as a 10DLC/branded sender in
 *                          Twilio — otherwise US carriers flag messages as
 *                          "unknown sender / may be spam". Carrier vetting takes
 *                          days; see https://www.twilio.com/docs/messaging/compliance/a2p-10dlc
 *   - TWILIO_BASE_URL      (defaults to https://api.twilio.com)
 *
 * REQ-523 (demo-loop cycle 3, m16): every send is guarded FIRST, in dev mode
 * and production alike — a missing, undialable or fictional number (NANP
 * area code 555, or the reserved 555-01XX block) is refused with
 * `{ ok: false, failureCode, reason: <lang key> }` and never reaches the
 * provider; a dialable number is sent in its E.164 form. So no caller can
 * report "texted" for a number that cannot get a text.
 *
 * If TWILIO_ACCOUNT_SID is not set, the service operates in **dev mode**:
 *   - logs the SMS to stdout (so you can read OTP codes during local dev)
 *   - returns `{ ok: true, reason: 'dev_mode_no_dispatch' }` for a number
 *     that passed the guard
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
    const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const token = Deno.env.get("TWILIO_AUTH_TOKEN");
    const from = Deno.env.get("TWILIO_FROM");

    // REQ-523: refuse what cannot take a text BEFORE the dev-mode short
    // circuit, so the fake never answers ok for a number Twilio would reject.
    const target = smsTarget(input.to);
    if (!target.ok) {
      const fictional = target.failureCode === "fictional";
      console.log(
        `[sms] refused to=${JSON.stringify(input.to)}: ${target.failureCode}${
          sid ? "" : ` (dev mode) body="${input.body}"`
        }`,
      );
      return {
        ok: false,
        reason: fictional ? "sms.fictionalNumber" : "sms.invalidNumber",
        failureCode: target.failureCode,
        detail: fictional
          ? `fictional number: ${target.e164} (never sent; Twilio would answer 21211)`
          : `${target.failureCode} number: ${JSON.stringify(input.to)}`,
      };
    }
    const to = target.e164;

    if (!sid) {
      console.log(
        `[sms:dev-mode] would send to=${to} body="${input.body}"`,
      );
      return { ok: true, reason: "dev_mode_no_dispatch" };
    }
    if (!token) return { ok: false, reason: "TWILIO_AUTH_TOKEN not set" };
    if (!from) return { ok: false, reason: "TWILIO_FROM not set" };

    // TWILIO_FROM must be a valid E.164 number AND registered as a 10DLC /
    // branded sender, or US carriers flag outbound texts as "unknown sender —
    // may be spam". We can only validate the shape here; the 10DLC vetting is
    // an external Twilio task (see service JSDoc). Warn loudly on a malformed
    // number so a misconfigured sender is obvious in the logs.
    if (!/^\+[1-9]\d{1,14}$/.test(from)) {
      console.error(
        `[sms] TWILIO_FROM="${from}" is not valid E.164 (^\\+[1-9]\\d{1,14}$). ` +
          "Register a 10DLC/branded sender: https://www.twilio.com/docs/messaging/compliance/a2p-10dlc",
      );
    }

    const baseUrl = Deno.env.get("TWILIO_BASE_URL") ?? "https://api.twilio.com";
    const f = this.fetchOverride ?? globalThis.fetch;

    // Twilio's create-message endpoint takes form-urlencoded.
    const form = new URLSearchParams();
    form.set("To", to);
    form.set("From", from);
    form.set("Body", input.body);

    try {
      const res = await f(
        `${baseUrl}/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            // HTTP Basic auth — Twilio standard.
            "Authorization": `Basic ${btoa(`${sid}:${token}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
          },
          body: form.toString(),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const detail = `twilio ${res.status}: ${text.slice(0, 200)}`;
        let code: number | undefined;
        try {
          const parsed = JSON.parse(text) as { code?: unknown };
          if (typeof parsed.code === "number") code = parsed.code;
        } catch { /* not JSON — keep the raw text as the reason */ }
        const key = code !== undefined ? TWILIO_REASON_KEYS[code] : undefined;
        const failureCode = code !== undefined
          ? TWILIO_FAILURE_CODES[code]
          : undefined;
        return {
          ok: false,
          reason: key ?? detail,
          ...(code !== undefined ? { code } : {}),
          ...(failureCode ? { failureCode } : {}),
          detail,
        };
      }
      const body = await res.json() as { sid?: string };
      return { ok: true, sid: body.sid };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }
}
