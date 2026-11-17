/**
 * REQ-899/903/905 — the Twilio REST client: Messages for the line, and the
 * subaccount provisioning a customer's line is made of. Same shape as the OTP
 * `SmsService`: a `fetchOverride` test seam, dev mode when no account SID,
 * Twilio's error code surfaced on a rejection. Reads `COMMS_*`, never `TWILIO_*`.
 * Every call authenticates as the main account: Twilio lets a parent act on
 * its subaccounts' resources, so no subaccount secret is ever needed here.
 */
import { Injectable } from "#danet/core";
import { CommsConfigSource } from "@communications/domain/data/config/mod.ts";
import {
  availableNumbersQuery,
  mapAvailable,
  type NumberSearch,
} from "@communications/domain/business/numbers/mod.ts";
import type { AvailableNumber } from "@communications/dto/mod.ts";

export interface SendMessageInput {
  to: string;
  body: string;
  /** our status-callback URL, so delivery state flows back (REQ-899) */
  statusCallback?: string;
  /** the line sending; the env line when absent (REQ-904) */
  from?: string;
  /** the account the line lives on; the main account when absent */
  accountSid?: string;
}

export interface SendMessageResult {
  ok: boolean;
  sid?: string;
  status?: string;
  /** "dev_mode_no_dispatch" | "not_configured" | a Twilio message | an error message */
  reason?: string;
  code?: number;
}

export type Failure = { ok: false; reason: string; code?: number };
type TwilioJson = Record<string, unknown>;

@Injectable()
export class TwilioClient {
  fetchOverride: typeof fetch | null = null;

  constructor(private cfgSource: CommsConfigSource) {}

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const cfg = this.cfgSource.get();
    if (cfg.devMode) {
      console.log(
        `[communications:dev-mode] would text from=${
          input.from ?? cfg.from
        } to=${input.to} body="${input.body}"`,
      );
      return { ok: true, reason: "dev_mode_no_dispatch", status: "dev" };
    }
    const from = input.from ?? cfg.from;
    if (!cfg.authToken || !from) return { ok: false, reason: "not_configured" };
    const form = new URLSearchParams();
    form.set("To", input.to);
    form.set("From", from);
    form.set("Body", input.body);
    if (input.statusCallback) form.set("StatusCallback", input.statusCallback);
    const res = await this.call(
      "POST",
      `/2010-04-01/Accounts/${
        input.accountSid ?? cfg.accountSid
      }/Messages.json`,
      form,
    );
    if (!res.ok) return res;
    return { ok: true, sid: str(res.json.sid), status: str(res.json.status) };
  }

  // ── provisioning (REQ-903/905) ─────────────────────────────────────────────

  async createSubaccount(
    input: { friendlyName: string },
  ): Promise<{ ok: true; sid: string; authToken: string } | Failure> {
    const res = await this.call(
      "POST",
      "/2010-04-01/Accounts.json",
      form({ FriendlyName: input.friendlyName }),
    );
    if (!res.ok) return res;
    return {
      ok: true,
      sid: str(res.json.sid),
      authToken: str(res.json.auth_token),
    };
  }

  async createApiKey(
    input: { accountSid: string; friendlyName: string },
  ): Promise<{ ok: true; sid: string; secret: string } | Failure> {
    const res = await this.call(
      "POST",
      `/2010-04-01/Accounts/${input.accountSid}/Keys.json`,
      form({ FriendlyName: input.friendlyName }),
    );
    if (!res.ok) return res;
    return { ok: true, sid: str(res.json.sid), secret: str(res.json.secret) };
  }

  async createTwimlApp(
    input: { accountSid: string; friendlyName: string; voiceUrl: string },
  ): Promise<{ ok: true; sid: string } | Failure> {
    const res = await this.call(
      "POST",
      `/2010-04-01/Accounts/${input.accountSid}/Applications.json`,
      form({
        FriendlyName: input.friendlyName,
        ...(input.voiceUrl
          ? { VoiceUrl: input.voiceUrl, VoiceMethod: "POST" }
          : {}),
      }), // REQ-918b
    );
    if (!res.ok) return res;
    return { ok: true, sid: str(res.json.sid) };
  }

  async searchAvailable(
    search: NumberSearch,
  ): Promise<{ ok: true; numbers: AvailableNumber[] } | Failure> {
    const cfg = this.cfgSource.get();
    const res = await this.call(
      "GET",
      `/2010-04-01/Accounts/${cfg.accountSid}/AvailablePhoneNumbers/US/Local.json?${
        availableNumbersQuery(search)
      }`,
    );
    if (!res.ok) return res;
    const rows = res.json.available_phone_numbers;
    return { ok: true, numbers: mapAvailable(Array.isArray(rows) ? rows : []) };
  }

  async buyNumber(
    input: {
      accountSid: string;
      phoneNumber: string;
      friendlyName?: string;
      voiceUrl: string;
      smsUrl: string;
      statusCallback: string;
    },
  ): Promise<{ ok: true; sid: string; phoneNumber: string } | Failure> {
    const res = await this.call(
      "POST",
      `/2010-04-01/Accounts/${input.accountSid}/IncomingPhoneNumbers.json`,
      form({
        PhoneNumber: input.phoneNumber,
        ...(input.friendlyName ? { FriendlyName: input.friendlyName } : {}),
        // REQ-918b: webhooks only when there is a public URL to point them at
        ...(input.voiceUrl
          ? { VoiceUrl: input.voiceUrl, VoiceMethod: "POST" }
          : {}),
        ...(input.smsUrl ? { SmsUrl: input.smsUrl, SmsMethod: "POST" } : {}),
        ...(input.statusCallback
          ? {
            StatusCallback: input.statusCallback,
            StatusCallbackMethod: "POST",
          }
          : {}),
      }),
    );
    if (!res.ok) return res;
    return {
      ok: true,
      sid: str(res.json.sid),
      phoneNumber: str(res.json.phone_number) || input.phoneNumber,
    };
  }

  async releaseNumber(
    input: { accountSid: string; numberSid: string },
  ): Promise<{ ok: true } | Failure> {
    const res = await this.call(
      "DELETE",
      `/2010-04-01/Accounts/${input.accountSid}/IncomingPhoneNumbers/${input.numberSid}.json`,
    );
    return res.ok ? { ok: true } : res;
  }

  async closeSubaccount(
    input: { accountSid: string },
  ): Promise<{ ok: true } | Failure> {
    const res = await this.call(
      "POST",
      `/2010-04-01/Accounts/${input.accountSid}.json`,
      form({ Status: "closed" }),
    );
    return res.ok ? { ok: true } : res;
  }

  // ── REQ-920b: the house path (main credentials throughout) ───────────────

  /** move a number into another of our accounts (a subaccount → the main account); Twilio wants the main credentials */
  async transferNumber(
    input: { numberSid: string; toAccountSid: string },
  ): Promise<{ ok: true } | Failure> {
    const cfg = this.cfgSource.get();
    const res = await this.call(
      "POST",
      `/2010-04-01/Accounts/${cfg.accountSid}/IncomingPhoneNumbers/${input.numberSid}.json`,
      form({ AccountSid: input.toAccountSid }),
    );
    return res.ok ? { ok: true } : res;
  }

  /** point a number's webhooks at us (empty URLs are left alone: REQ-918b) */
  async updateNumber(
    input: {
      accountSid: string;
      numberSid: string;
      voiceUrl: string;
      smsUrl: string;
      statusCallback: string;
    },
  ): Promise<{ ok: true } | Failure> {
    const res = await this.call(
      "POST",
      `/2010-04-01/Accounts/${input.accountSid}/IncomingPhoneNumbers/${input.numberSid}.json`,
      form({
        ...(input.voiceUrl
          ? { VoiceUrl: input.voiceUrl, VoiceMethod: "POST" }
          : {}),
        ...(input.smsUrl ? { SmsUrl: input.smsUrl, SmsMethod: "POST" } : {}),
        ...(input.statusCallback
          ? {
            StatusCallback: input.statusCallback,
            StatusCallbackMethod: "POST",
          }
          : {}),
      }),
    );
    return res.ok ? { ok: true } : res;
  }

  async listMessagingServices(): Promise<
    { ok: true; services: { sid: string; friendlyName: string }[] } | Failure
  > {
    const res = await this.call(
      "GET",
      "/v1/Services?PageSize=100",
      undefined,
      "messaging",
    );
    if (!res.ok) return res;
    const rows = Array.isArray(res.json.services)
      ? res.json.services as Record<string, unknown>[]
      : [];
    return {
      ok: true,
      services: rows.map((r) => ({
        sid: str(r.sid),
        friendlyName: str(r.friendly_name),
      })),
    };
  }

  async listCampaigns(
    input: { serviceSid: string },
  ): Promise<
    | {
      ok: true;
      campaigns: { sid: string; usecase: string; status: string }[];
    }
    | Failure
  > {
    const res = await this.call(
      "GET",
      `/v1/Services/${input.serviceSid}/Compliance/Usa2p`,
      undefined,
      "messaging",
    );
    if (!res.ok) return res;
    const rows = Array.isArray(res.json.compliance)
      ? res.json.compliance as Record<string, unknown>[]
      : [];
    return {
      ok: true,
      campaigns: rows.map((r) => ({
        sid: str(r.sid),
        usecase: str(r.us_app_to_person_usecase),
        status: str(r.campaign_status),
      })),
    };
  }

  async addNumberToService(
    input: { serviceSid: string; numberSid: string },
  ): Promise<{ ok: true } | Failure> {
    const res = await this.call(
      "POST",
      `/v1/Services/${input.serviceSid}/PhoneNumbers`,
      form({ PhoneNumberSid: input.numberSid }),
      "messaging",
    );
    return res.ok ? { ok: true } : res;
  }

  // ── the one HTTP path ──────────────────────────────────────────────────────

  private async call(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: URLSearchParams,
    host: "api" | "messaging" = "api",
  ): Promise<{ ok: true; json: TwilioJson } | Failure> {
    const cfg = this.cfgSource.get();
    if (cfg.devMode || !cfg.authToken) {
      return { ok: false, reason: "not_configured" };
    }
    const f = this.fetchOverride ?? globalThis.fetch;
    try {
      const res = await f(
        `${host === "messaging" ? cfg.messagingBaseUrl : cfg.baseUrl}${path}`,
        {
          method,
          headers: {
            "Authorization": `Basic ${
              btoa(`${cfg.accountSid}:${cfg.authToken}`)
            }`,
            "Accept": "application/json",
            ...(body
              ? { "Content-Type": "application/x-www-form-urlencoded" }
              : {}),
          },
          ...(body ? { body: body.toString() } : {}),
        },
      );
      const text = await res.text();
      let parsed: TwilioJson = {};
      try {
        parsed = text ? JSON.parse(text) as TwilioJson : {};
      } catch { /* non-JSON error page */ }
      if (!res.ok) {
        return {
          ok: false,
          reason: typeof parsed.message === "string"
            ? parsed.message
            : `twilio ${res.status}: ${text.slice(0, 200)}`,
          ...(typeof parsed.code === "number" ? { code: parsed.code } : {}),
        };
      }
      return { ok: true, json: parsed };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }
}

function form(fields: Record<string, string>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) p.set(k, v);
  return p;
}
const str = (v: unknown): string => (typeof v === "string" ? v : "");
