/**
 * REQ-920 — Twilio's TrustHub (customer profiles, trust products, end users,
 * supporting documents), Messaging (brand registrations, messaging services,
 * campaigns) and the Addresses resource, for the A2P 10DLC ISV walk. Every
 * call names the credentials it runs as: the customer's SUBACCOUNT for its own
 * registration, the MAIN account for the platform's primary-profile lookup.
 * Same shape as TwilioClient: a `fetchOverride` seam, a `Failure` with
 * Twilio's code, hosts from config so a test points them at a stand-in.
 */
import { Injectable } from "#danet/core";
import { CommsConfigSource } from "@communications/domain/data/config/mod.ts";
import type { Failure } from "@communications/domain/data/twilio-client/mod.ts";

export type { Failure };

/** the account a call runs as */
export interface TwilioAuth {
  accountSid: string;
  authToken: string;
}

export type BundleKind = "CustomerProfiles" | "TrustProducts";

export interface BundleStatus {
  sid: string;
  status: string;
  errors: { message: string; code?: number }[];
}

export interface Evaluation {
  status: string;
  results: unknown[];
}

export interface BrandStatus {
  sid: string;
  status: string;
  failureReason: string;
  errors: { message: string; code?: number }[];
}

export interface CampaignStatus {
  sid: string;
  status: string;
  errors: { message: string; code?: number }[];
}

type Json = Record<string, unknown>;
type Host = "trusthub" | "messaging" | "api";
type Fields = Record<string, string | string[] | undefined>;

@Injectable()
export class TrustHubClient {
  fetchOverride: typeof fetch | null = null;

  constructor(private cfgSource: CommsConfigSource) {}

  // ── bundles: the secondary customer profile and the A2P trust product ──────

  async createBundle(
    auth: TwilioAuth,
    kind: BundleKind,
    input: {
      friendlyName: string;
      email: string;
      policySid: string;
      statusCallback?: string;
    },
  ): Promise<{ ok: true; sid: string; status: string } | Failure> {
    const res = await this.call(auth, "POST", "trusthub", `/v1/${kind}`, {
      FriendlyName: input.friendlyName,
      Email: input.email,
      PolicySid: input.policySid,
      StatusCallback: input.statusCallback || undefined,
    });
    if (!res.ok) return res;
    return { ok: true, sid: str(res.json.sid), status: str(res.json.status) };
  }

  async assign(
    auth: TwilioAuth,
    kind: BundleKind,
    bundleSid: string,
    objectSid: string,
  ): Promise<{ ok: true } | Failure> {
    const res = await this.call(
      auth,
      "POST",
      "trusthub",
      `/v1/${kind}/${bundleSid}/EntityAssignments`,
      { ObjectSid: objectSid },
    );
    return res.ok ? { ok: true } : res;
  }

  async evaluate(
    auth: TwilioAuth,
    kind: BundleKind,
    bundleSid: string,
    policySid: string,
  ): Promise<({ ok: true } & Evaluation) | Failure> {
    const res = await this.call(
      auth,
      "POST",
      "trusthub",
      `/v1/${kind}/${bundleSid}/Evaluations`,
      { PolicySid: policySid },
    );
    if (!res.ok) return res;
    return {
      ok: true,
      status: str(res.json.status),
      results: Array.isArray(res.json.results) ? res.json.results : [],
    };
  }

  async submit(
    auth: TwilioAuth,
    kind: BundleKind,
    bundleSid: string,
  ): Promise<{ ok: true; status: string } | Failure> {
    const res = await this.call(
      auth,
      "POST",
      "trusthub",
      `/v1/${kind}/${bundleSid}`,
      { Status: "pending-review" },
    );
    if (!res.ok) return res;
    return { ok: true, status: str(res.json.status) || "pending-review" };
  }

  async getBundle(
    auth: TwilioAuth,
    kind: BundleKind,
    bundleSid: string,
  ): Promise<({ ok: true } & BundleStatus) | Failure> {
    const res = await this.call(
      auth,
      "GET",
      "trusthub",
      `/v1/${kind}/${bundleSid}`,
    );
    if (!res.ok) return res;
    return {
      ok: true,
      sid: str(res.json.sid) || bundleSid,
      status: str(res.json.status),
      errors: errorsOf(res.json.errors),
    };
  }

  // ── end users, supporting documents, addresses ─────────────────────────────

  async createEndUser(
    auth: TwilioAuth,
    input: {
      friendlyName: string;
      type: string;
      attributes: Record<string, string>;
    },
  ): Promise<{ ok: true; sid: string } | Failure> {
    const res = await this.call(auth, "POST", "trusthub", "/v1/EndUsers", {
      FriendlyName: input.friendlyName,
      Type: input.type,
      Attributes: JSON.stringify(input.attributes),
    });
    if (!res.ok) return res;
    return { ok: true, sid: str(res.json.sid) };
  }

  async updateEndUser(
    auth: TwilioAuth,
    sid: string,
    attributes: Record<string, string>,
  ): Promise<{ ok: true } | Failure> {
    const res = await this.call(
      auth,
      "POST",
      "trusthub",
      `/v1/EndUsers/${sid}`,
      { Attributes: JSON.stringify(attributes) },
    );
    return res.ok ? { ok: true } : res;
  }

  async createSupportingDocument(
    auth: TwilioAuth,
    input: {
      friendlyName: string;
      type: string;
      attributes: Record<string, string>;
    },
  ): Promise<{ ok: true; sid: string } | Failure> {
    const res = await this.call(
      auth,
      "POST",
      "trusthub",
      "/v1/SupportingDocuments",
      {
        FriendlyName: input.friendlyName,
        Type: input.type,
        Attributes: JSON.stringify(input.attributes),
      },
    );
    if (!res.ok) return res;
    return { ok: true, sid: str(res.json.sid) };
  }

  async createAddress(
    auth: TwilioAuth,
    fields: Record<string, string>,
  ): Promise<{ ok: true; sid: string } | Failure> {
    const res = await this.call(
      auth,
      "POST",
      "api",
      `/2010-04-01/Accounts/${auth.accountSid}/Addresses.json`,
      fields,
    );
    if (!res.ok) return res;
    return { ok: true, sid: str(res.json.sid) };
  }

  // ── the platform's primary profile (main account) ──────────────────────────

  async listApprovedProfiles(
    auth: TwilioAuth,
  ): Promise<{ ok: true; sids: string[] } | Failure> {
    const res = await this.call(
      auth,
      "GET",
      "trusthub",
      "/v1/CustomerProfiles?Status=twilio-approved&PageSize=50",
    );
    if (!res.ok) return res;
    return {
      ok: true,
      sids: rows(res.json.results).map((r) => str(r.sid)).filter(Boolean),
    };
  }

  async listAssignments(
    auth: TwilioAuth,
    kind: BundleKind,
    bundleSid: string,
  ): Promise<{ ok: true; objectSids: string[] } | Failure> {
    const res = await this.call(
      auth,
      "GET",
      "trusthub",
      `/v1/${kind}/${bundleSid}/EntityAssignments?PageSize=50`,
    );
    if (!res.ok) return res;
    return {
      ok: true,
      objectSids: rows(res.json.results).map((r) => str(r.object_sid)).filter(
        Boolean,
      ),
    };
  }

  async getEndUser(
    auth: TwilioAuth,
    sid: string,
  ): Promise<{ ok: true; type: string; attributes: Json } | Failure> {
    const res = await this.call(auth, "GET", "trusthub", `/v1/EndUsers/${sid}`);
    if (!res.ok) return res;
    let attributes = res.json.attributes;
    if (typeof attributes === "string") {
      try {
        attributes = JSON.parse(attributes);
      } catch {
        attributes = {};
      }
    }
    return {
      ok: true,
      type: str(res.json.type),
      attributes:
        (attributes && typeof attributes === "object"
          ? attributes
          : {}) as Json,
    };
  }

  // ── brand, messaging service, campaign ─────────────────────────────────────

  async createBrand(
    auth: TwilioAuth,
    input: { customerProfileSid: string; trustProductSid: string },
  ): Promise<({ ok: true } & BrandStatus) | Failure> {
    const res = await this.call(
      auth,
      "POST",
      "messaging",
      "/v1/a2p/BrandRegistrations",
      {
        CustomerProfileBundleSid: input.customerProfileSid,
        A2PProfileBundleSid: input.trustProductSid,
        SkipAutomaticSecVet: "true",
      },
    );
    if (!res.ok) return res;
    return { ok: true, ...brandOf(res.json) };
  }

  async getBrand(
    auth: TwilioAuth,
    sid: string,
  ): Promise<({ ok: true } & BrandStatus) | Failure> {
    const res = await this.call(
      auth,
      "GET",
      "messaging",
      `/v1/a2p/BrandRegistrations/${sid}`,
    );
    if (!res.ok) return res;
    return { ok: true, ...brandOf(res.json) };
  }

  async createService(
    auth: TwilioAuth,
    input: {
      friendlyName: string;
      inboundUrl?: string;
      statusCallback?: string;
    },
  ): Promise<{ ok: true; sid: string } | Failure> {
    const res = await this.call(auth, "POST", "messaging", "/v1/Services", {
      FriendlyName: input.friendlyName,
      ...(input.inboundUrl
        ? {
          InboundRequestUrl: input.inboundUrl,
          InboundMethod: "POST",
          UseInboundWebhookOnNumber: "false",
        }
        : {}),
      StatusCallback: input.statusCallback || undefined,
    });
    if (!res.ok) return res;
    return { ok: true, sid: str(res.json.sid) };
  }

  async addNumber(
    auth: TwilioAuth,
    serviceSid: string,
    numberSid: string,
  ): Promise<{ ok: true } | Failure> {
    const res = await this.call(
      auth,
      "POST",
      "messaging",
      `/v1/Services/${serviceSid}/PhoneNumbers`,
      { PhoneNumberSid: numberSid },
    );
    return res.ok ? { ok: true } : res;
  }

  async createCampaign(
    auth: TwilioAuth,
    serviceSid: string,
    fields: Record<string, string | string[]>,
  ): Promise<({ ok: true } & CampaignStatus) | Failure> {
    const res = await this.call(
      auth,
      "POST",
      "messaging",
      `/v1/Services/${serviceSid}/Compliance/Usa2p`,
      fields,
    );
    if (!res.ok) return res;
    return { ok: true, ...campaignOf(res.json) };
  }

  async getCampaign(
    auth: TwilioAuth,
    serviceSid: string,
    sid: string,
  ): Promise<({ ok: true } & CampaignStatus) | Failure> {
    const res = await this.call(
      auth,
      "GET",
      "messaging",
      `/v1/Services/${serviceSid}/Compliance/Usa2p/${sid}`,
    );
    if (!res.ok) return res;
    return { ok: true, ...campaignOf(res.json) };
  }

  // ── the one HTTP path ──────────────────────────────────────────────────────

  private async call(
    auth: TwilioAuth,
    method: "GET" | "POST",
    host: Host,
    path: string,
    fields?: Fields,
  ): Promise<{ ok: true; json: Json } | Failure> {
    const cfg = this.cfgSource.get();
    if (!auth.accountSid || !auth.authToken) {
      return { ok: false, reason: "not_configured" };
    }
    const origin = host === "trusthub"
      ? cfg.trusthubBaseUrl
      : host === "messaging"
      ? cfg.messagingBaseUrl
      : cfg.baseUrl;
    const body = fields ? formOf(fields) : undefined;
    const f = this.fetchOverride ?? globalThis.fetch;
    try {
      const res = await f(`${origin}${path}`, {
        method,
        headers: {
          "Authorization": `Basic ${
            btoa(`${auth.accountSid}:${auth.authToken}`)
          }`,
          "Accept": "application/json",
          ...(body
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        ...(body ? { body: body.toString() } : {}),
      });
      const text = await res.text();
      let parsed: Json = {};
      try {
        parsed = text ? JSON.parse(text) as Json : {};
      } catch { /* a non-JSON error page */ }
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

/** undefined fields are left out; a list is sent as the same field repeated (Twilio's list encoding) */
function formOf(fields: Fields): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) { for (const item of v) p.append(k, item); }
    else p.set(k, v);
  }
  return p;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const rows = (
  v: unknown,
): Json[] => (Array.isArray(v)
  ? v.filter((r) => r && typeof r === "object") as Json[]
  : []);

/** Twilio's error lists come as {code, message} | {error_code, description} | strings */
function errorsOf(v: unknown): { message: string; code?: number }[] {
  if (!Array.isArray(v)) return [];
  return v.map((e) => {
    if (typeof e === "string") return { message: e };
    const o = (e ?? {}) as Json;
    const message = str(o.message) || str(o.description) || str(o.detail) ||
      JSON.stringify(o);
    const code = typeof o.code === "number"
      ? o.code
      : typeof o.error_code === "number"
      ? o.error_code
      : undefined;
    return { message, ...(code !== undefined ? { code } : {}) };
  });
}

function brandOf(j: Json): BrandStatus {
  return {
    sid: str(j.sid),
    status: str(j.status),
    failureReason: str(j.failure_reason),
    errors: errorsOf(j.errors),
  };
}

function campaignOf(j: Json): CampaignStatus {
  return {
    sid: str(j.sid),
    status: str(j.campaign_status),
    errors: errorsOf(j.errors),
  };
}
