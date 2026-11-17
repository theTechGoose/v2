/**
 * REQ-920a — the Texting registration panel's pure part: the form's state and
 * its rules (the same rules the server applies in
 * backend/src/communications/domain/business/a2p, so a refusal shows before
 * the round trip), the status strip, the headline, and the two error shapes
 * the API answers with (the gate's 403 a2p_unregistered, the form's 400
 * a2p_invalid naming its fields). Messages are dictionary keys.
 */
import { ApiError } from "./api.ts";
import type { LineSummary } from "../clients/systems.ts";

export const BUSINESS_TYPES = [
  "Sole Proprietorship",
  "Partnership",
  "Limited Liability Corporation",
  "Co-operative",
  "Non-profit Corporation",
  "Corporation",
] as const;

export const INDUSTRIES = [
  "CONSTRUCTION",
  "REAL_ESTATE",
  "PROFESSIONAL_SERVICES",
  "RETAIL",
  "HOSPITALITY",
  "HEALTHCARE",
  "AUTOMOTIVE",
  "TRANSPORTATION",
  "FOOD_AND_BEVERAGE",
  "EDUCATION",
  "TECHNOLOGY",
  "CONSUMER",
  "LEGAL",
  "INSURANCE",
  "FINANCIAL",
  "MANUFACTURING",
  "AGRICULTURE",
  "ENERGY",
  "MEDIA",
  "TRAVEL",
  "ONLINE",
] as const;

export const JOB_POSITIONS = [
  "Director",
  "GM",
  "VP",
  "CEO",
  "CFO",
  "General Counsel",
  "Other",
] as const;
export const COMPANY_TYPES = [
  "private",
  "public",
  "non-profit",
  "government",
] as const;
export const USE_CASES = [
  "CUSTOMER_CARE",
  "MIXED",
  "MARKETING",
  "ACCOUNT_NOTIFICATION",
  "DELIVERY_NOTIFICATION",
  "2FA",
] as const;
export const STOCK_EXCHANGES = ["NASDAQ", "NYSE", "AMEX", "OTHER"] as const;

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR"
    .split(" "),
);

/** the panel's state: every field a string except the samples (five boxes) and the two checkboxes */
export interface A2pFormState {
  legalName: string;
  ein: string;
  businessType: string;
  industry: string;
  website: string;
  socialUrls: string;
  companyType: string;
  stockExchange: string;
  stockTicker: string;
  repFirstName: string;
  repLastName: string;
  repEmail: string;
  repPhone: string;
  repTitle: string;
  repPosition: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  useCase: string;
  description: string;
  messageFlow: string;
  samples: string[];
  optInMessage: string;
  optOutMessage: string;
  helpMessage: string;
  hasEmbeddedLinks: boolean;
  hasEmbeddedPhone: boolean;
}

export const SAMPLE_SLOTS = 5;

export function emptyA2pForm(): A2pFormState {
  return {
    legalName: "",
    ein: "",
    businessType: "",
    industry: "",
    website: "",
    socialUrls: "",
    companyType: "private",
    stockExchange: "",
    stockTicker: "",
    repFirstName: "",
    repLastName: "",
    repEmail: "",
    repPhone: "",
    repTitle: "",
    repPosition: "",
    street: "",
    city: "",
    region: "",
    postalCode: "",
    useCase: "CUSTOMER_CARE",
    description: "",
    messageFlow: "",
    samples: Array(SAMPLE_SLOTS).fill(""),
    optInMessage: "",
    optOutMessage: "",
    helpMessage: "",
    hasEmbeddedLinks: false,
    hasEmbeddedPhone: false,
  };
}

/** suggested opt-in / opt-out / help wording (the carriers want the business named and the keywords spelled out) */
export function defaultCopy(
  business: string,
  phone = "",
): Pick<A2pFormState, "optInMessage" | "optOutMessage" | "helpMessage"> {
  const name = business.trim() || "We";
  return {
    optInMessage:
      `${name}: you're subscribed to texts about your service. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`,
    optOutMessage:
      `${name}: you're unsubscribed and will get no more texts. Reply START to resubscribe.`,
    helpMessage: `${name}: for help${
      phone.trim() ? ` call ${phone.trim()} or` : ""
    } reply to this text. Msg & data rates may apply. Reply STOP to opt out.`,
  };
}

const isUrl = (s: string): boolean => {
  try {
    const u = new URL(s);
    return (u.protocol === "https:" || u.protocol === "http:") &&
      u.hostname.includes(".");
  } catch {
    return false;
  }
};
const phoneDigits = (s: string) => s.replace(/\D/g, "");
const filledSamples = (f: A2pFormState) =>
  f.samples.map((s) => s.trim()).filter(Boolean);

/** field → error key; {} when the form may be sent */
export function validateA2pForm(f: A2pFormState): Record<string, string> {
  const err: Record<string, string> = {};
  const required = (k: keyof A2pFormState) => {
    if (!String(f[k] ?? "").trim()) err[k] = "comms.a2p.err.required";
  };
  const length = (k: keyof A2pFormState, min: number, max: number) => {
    const v = String(f[k] ?? "").trim();
    if (!v) err[k] = "comms.a2p.err.required";
    else if (v.length < min || v.length > max) {
      err[k] = `comms.a2p.err.len${min}`;
    }
  };
  required("legalName");
  const ein = f.ein.trim();
  if (!ein) err.ein = "comms.a2p.err.required";
  else if (!/^[\d\s-]+$/.test(ein) || phoneDigits(ein).length !== 9) {
    err.ein = "comms.a2p.err.ein";
  }
  required("businessType");
  required("industry");
  if (!f.website.trim()) err.website = "comms.a2p.err.required";
  else if (!isUrl(f.website.trim())) err.website = "comms.a2p.err.url";
  if (f.companyType === "public") {
    required("stockExchange");
    required("stockTicker");
  }
  required("repFirstName");
  required("repLastName");
  if (!f.repEmail.trim()) err.repEmail = "comms.a2p.err.required";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.repEmail.trim())) {
    err.repEmail = "comms.a2p.err.email";
  }
  const digits = phoneDigits(f.repPhone);
  if (!digits) err.repPhone = "comms.a2p.err.required";
  else if (digits.length < 10 || digits.length > 15) {
    err.repPhone = "comms.a2p.err.phone";
  }
  required("repTitle");
  required("repPosition");
  required("street");
  required("city");
  if (!US_STATES.has(f.region.trim().toUpperCase())) {
    err.region = f.region.trim()
      ? "comms.a2p.err.state"
      : "comms.a2p.err.required";
  }
  if (!/^\d{5}(-\d{4})?$/.test(f.postalCode.trim())) {
    err.postalCode = f.postalCode.trim()
      ? "comms.a2p.err.zip"
      : "comms.a2p.err.required";
  }
  required("useCase");
  length("description", 40, 4096);
  length("messageFlow", 40, 2048);
  const samples = filledSamples(f);
  if (
    samples.length < 2 || samples.length > 5 ||
    samples.some((s) => s.length < 20 || s.length > 1024)
  ) err.samples = "comms.a2p.err.samples";
  length("optInMessage", 20, 320);
  length("optOutMessage", 20, 320);
  length("helpMessage", 20, 320);
  return err;
}

/** the request body: trimmed, the empty sample boxes dropped, the stock fields only for a public company */
export function toA2pBody(f: A2pFormState): Record<string, unknown> {
  const trimmed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    trimmed[k] = typeof v === "string" ? v.trim() : v;
  }
  trimmed.samples = filledSamples(f);
  if (f.companyType !== "public") {
    delete trimmed.stockExchange;
    delete trimmed.stockTicker;
  }
  return trimmed;
}

/** a saved registration's form → the panel's state (five sample boxes) */
export function formFromRegistration(
  reg: { form?: Record<string, unknown> } | null | undefined,
): A2pFormState {
  const base = emptyA2pForm();
  const saved = reg?.form ?? {};
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(base)) {
    const v = saved[k];
    if (k === "samples") {
      const list = Array.isArray(v) ? v.map(String) : [];
      out.samples = [...list, ...Array(SAMPLE_SLOTS).fill("")].slice(
        0,
        SAMPLE_SLOTS,
      );
    } else if (
      typeof v === typeof (base as unknown as Record<string, unknown>)[k]
    ) {
      out[k] = v;
    }
  }
  return out as unknown as A2pFormState;
}

// ── statuses ─────────────────────────────────────────────────────────────────

export type StepStatus = "todo" | "pending" | "ok" | "failed";

interface Statuses {
  profileSid?: string;
  profileStatus?: string;
  profileSubmitted?: boolean;
  brandSid?: string;
  brandStatus?: string;
  campaignSid?: string;
  campaignStatus?: string;
}

/** the strip: profile → brand → campaign */
export function stepStatuses(
  r: Statuses | null | undefined,
): { profile: StepStatus; brand: StepStatus; campaign: StepStatus } {
  const profile: StepStatus = !r?.profileSid
    ? "todo"
    : r.profileStatus === "twilio-approved"
    ? "ok"
    : r.profileStatus === "twilio-rejected"
    ? "failed"
    : r.profileSubmitted
    ? "pending"
    : "todo";
  const brand: StepStatus = !r?.brandSid
    ? "todo"
    : r.brandStatus === "APPROVED"
    ? "ok"
    : ["FAILED", "SUSPENDED", "DELETED"].includes(r.brandStatus ?? "")
    ? "failed"
    : "pending";
  const campaign: StepStatus = !r?.campaignSid
    ? "todo"
    : r.campaignStatus === "VERIFIED"
    ? "ok"
    : ["FAILED", "EXPIRED"].includes(r.campaignStatus ?? "")
    ? "failed"
    : "pending";
  return { profile, brand, campaign };
}

export type A2pHeadline =
  | "none"
  | "needs_isv"
  | "pending"
  | "registered"
  | "failed";

/** the one word at the top of the panel */
export function a2pHeadline(
  r: { state?: string } | null | undefined,
): A2pHeadline {
  const s = r?.state ?? "none";
  if (s === "registered") return "registered";
  if (s === "needs_isv_primary") return "needs_isv";
  if (s.endsWith("_failed")) return "failed";
  if (s.endsWith("_pending")) return "pending";
  return "none";
}

export const STEP_CHIP: Record<StepStatus, string> = {
  todo: "chip--muted",
  pending: "chip--teal",
  ok: "chip--green",
  failed: "chip--pink",
};

export const HEADLINE_CHIP: Record<A2pHeadline, string> = {
  none: "chip--muted",
  needs_isv: "chip--muted",
  pending: "chip--teal",
  registered: "chip--green",
  failed: "chip--pink",
};

// ── the API's two error shapes ───────────────────────────────────────────────

const codeOf = (e: unknown): string =>
  e instanceof ApiError && e.body && typeof e.body === "object"
    ? String((e.body as { code?: unknown }).code ?? "")
    : "";

/** the texting gate: this number is not registered yet (403 a2p_unregistered) */
export function isA2pRefusal(e: unknown): boolean {
  return codeOf(e) === "a2p_unregistered";
}

/** 400 a2p_invalid → field → the server's message */
export function a2pFieldErrors(e: unknown): Record<string, string> {
  if (codeOf(e) !== "a2p_invalid") return {};
  const fields = (e as ApiError).body as { fields?: unknown };
  const out: Record<string, string> = {};
  for (const f of Array.isArray(fields.fields) ? fields.fields : []) {
    const { field, message } = (f ?? {}) as {
      field?: unknown;
      message?: unknown;
    };
    if (typeof field === "string") out[field] = String(message ?? "");
  }
  return out;
}

/** REQ-920d — the Systems card's registration word for a line: a customer line's own, "house" for a line on the platform's campaign */
export type SystemsA2p = "none" | "pending" | "registered" | "failed" | "house";

export function systemsA2p(
  line: LineSummary | undefined | null,
): SystemsA2p | undefined {
  if (!line || line.status !== "active" || line.kind === "env") {
    return undefined;
  }
  return line.a2p;
}
