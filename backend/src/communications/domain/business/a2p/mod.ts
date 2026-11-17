/**
 * REQ-920a — texting registration (A2P 10DLC), the pure part: the form's
 * rules, what Twilio's TrustHub / Messaging APIs are sent for it, the one
 * state a registration is in, and the texting gate.
 */
import { safePhone } from "@communications/dto/mod.ts";
import type {
  A2pError,
  A2pForm,
  A2pRegistration,
  A2pState,
  A2pStep,
  A2pSummary,
} from "@communications/dto/mod.ts";

/** Twilio's policies: the secondary customer profile, and the A2P messaging profile (trust product) */
export const A2P_POLICY = {
  customerProfile: "RNdfbf3fae0e1107f8aded0e7cead80bf5",
  trustProduct: "RNb0d4771c2c98518d916a3d4cd70a8f8b",
} as const;

export const PRIVACY_POLICY_URL = "https://documonster.com/privacy";
export const SMS_TERMS_URL = "https://documonster.com/sms-terms";

export const BUSINESS_TYPES = [
  "Sole Proprietorship",
  "Partnership",
  "Limited Liability Corporation",
  "Co-operative",
  "Non-profit Corporation",
  "Corporation",
] as const;

/** a subset of Twilio's business_industry enum that covers the trades DocuMonster serves */
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

export interface A2pFieldError {
  field: string;
  message: string;
}

/** 400: the form broke a rule; `fields` names every one (Danet puts it in the body) */
export class A2pFormError extends Error {
  readonly status: number = 400;
  readonly code = "a2p_invalid";
  readonly fields: A2pFieldError[];
  constructor(fields: A2pFieldError[]) {
    super(
      `the registration form has ${fields.length} problem${
        fields.length === 1 ? "" : "s"
      }: ${fields.map((f) => f.field).join(", ")}`,
    );
    this.name = "A2pFormError";
    this.fields = fields;
  }
}

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR"
    .split(" "),
);

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isUrl = (s: string): boolean => {
  try {
    const u = new URL(s);
    return (u.protocol === "https:" || u.protocol === "http:") &&
      u.hostname.includes(".");
  } catch {
    return false;
  }
};
const keywords = (v: unknown, fallback: string): string[] => {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const list = raw.map((k) => str(k).toUpperCase()).filter(Boolean);
  return list.length ? [...new Set(list)] : [fallback];
};

/** the body of POST /communications/a2p → a form, or 400 naming every broken field */
export function parseA2pForm(body: unknown): A2pForm {
  const b = (body ?? {}) as Record<string, unknown>;
  const bad: A2pFieldError[] = [];
  const need = (field: string, ok: boolean, message: string) => {
    if (!ok) bad.push({ field, message });
  };
  const len = (field: string, min: number, max: number): string => {
    const v = str(b[field]);
    need(
      field,
      v.length >= min && v.length <= max,
      `${field} must be ${min}–${max} characters`,
    );
    return v;
  };
  const oneOf = <T extends readonly string[]>(
    field: string,
    list: T,
    normalize = (s: string) => s,
  ): string => {
    const v = normalize(str(b[field]));
    need(
      field,
      (list as readonly string[]).includes(v),
      `${field} must be one of: ${list.join(", ")}`,
    );
    return v;
  };

  const legalName = len("legalName", 2, 255);
  const einDigits = str(b.ein).replace(/\D/g, "");
  need(
    "ein",
    einDigits.length === 9 && /^[\d\s-]+$/.test(str(b.ein)),
    "ein must be the 9-digit EIN (12-3456789)",
  );
  const businessType = oneOf("businessType", BUSINESS_TYPES);
  const industry = oneOf("industry", INDUSTRIES, (s) => s.toUpperCase());
  const website = str(b.website);
  need("website", isUrl(website), "website must be a full https:// address");
  const socialUrls = str(b.socialUrls);
  const companyType = oneOf(
    "companyType",
    COMPANY_TYPES,
    (s) => s.toLowerCase(),
  );
  const stockExchange = str(b.stockExchange).toUpperCase();
  const stockTicker = str(b.stockTicker).toUpperCase();
  if (companyType === "public") {
    need(
      "stockExchange",
      Boolean(stockExchange),
      "a public company needs its stock exchange",
    );
    need(
      "stockTicker",
      Boolean(stockTicker),
      "a public company needs its ticker",
    );
  }

  const repFirstName = len("repFirstName", 1, 100);
  const repLastName = len("repLastName", 1, 100);
  const repEmail = str(b.repEmail);
  need(
    "repEmail",
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(repEmail),
    "repEmail must be an email address",
  );
  const repPhone = safePhone(str(b.repPhone));
  need("repPhone", Boolean(repPhone), "repPhone must be a phone number");
  const repTitle = len("repTitle", 1, 100);
  const repPosition = oneOf("repPosition", JOB_POSITIONS);

  const street = len("street", 3, 255);
  const city = len("city", 2, 100);
  const region = str(b.region).toUpperCase();
  need("region", US_STATES.has(region), "region must be a two-letter US state");
  const postalCode = str(b.postalCode);
  need(
    "postalCode",
    /^\d{5}(-\d{4})?$/.test(postalCode),
    "postalCode must be a ZIP code",
  );

  const useCase = oneOf("useCase", USE_CASES, (s) => s.toUpperCase());
  const description = len("description", 40, 4096);
  const messageFlow = len("messageFlow", 40, 2048);
  const samples = (Array.isArray(b.samples) ? b.samples : []).map(str).filter(
    Boolean,
  );
  need(
    "samples",
    samples.length >= 2 && samples.length <= 5 &&
      samples.every((s) => s.length >= 20 && s.length <= 1024),
    "samples must be 2–5 messages of 20–1024 characters",
  );
  const optInMessage = len("optInMessage", 20, 320);
  const optOutMessage = len("optOutMessage", 20, 320);
  const helpMessage = len("helpMessage", 20, 320);

  if (bad.length) throw new A2pFormError(bad);
  return {
    legalName,
    ein: einDigits,
    businessType,
    industry,
    website,
    ...(socialUrls ? { socialUrls } : {}),
    companyType,
    ...(companyType === "public" ? { stockExchange, stockTicker } : {}),
    repFirstName,
    repLastName,
    repEmail,
    repPhone,
    repTitle,
    repPosition,
    street,
    city,
    region,
    postalCode,
    useCase,
    description,
    messageFlow,
    samples,
    optInMessage,
    optOutMessage,
    helpMessage,
    hasEmbeddedLinks: b.hasEmbeddedLinks === true,
    hasEmbeddedPhone: b.hasEmbeddedPhone === true,
    optInKeywords: keywords(b.optInKeywords, "START"),
    optOutKeywords: keywords(b.optOutKeywords, "STOP"),
    helpKeywords: keywords(b.helpKeywords, "HELP"),
  };
}

// ── what Twilio is sent ──────────────────────────────────────────────────────

/** EndUser `customer_profile_business_information` */
export function businessAttributes(f: A2pForm): Record<string, string> {
  return {
    business_name: f.legalName,
    business_identity: "direct_customer",
    business_type: f.businessType,
    business_industry: f.industry,
    business_registration_identifier: "EIN",
    business_registration_number: f.ein,
    business_regions_of_operation: "USA_AND_CANADA",
    website_url: f.website,
    ...(f.socialUrls ? { social_media_profile_urls: f.socialUrls } : {}),
  };
}

/** EndUser `authorized_representative_1` */
export function representativeAttributes(f: A2pForm): Record<string, string> {
  return {
    first_name: f.repFirstName,
    last_name: f.repLastName,
    email: f.repEmail,
    phone_number: f.repPhone,
    business_title: f.repTitle,
    job_position: f.repPosition,
  };
}

/** EndUser `us_a2p_messaging_profile_information` (the trust product's) */
export function messagingProfileAttributes(f: A2pForm): Record<string, string> {
  return {
    company_type: f.companyType,
    ...(f.companyType === "public"
      ? {
        stock_exchange: f.stockExchange ?? "",
        stock_ticker: f.stockTicker ?? "",
      }
      : {}),
  };
}

/** the Address resource on the subaccount */
export function addressFields(f: A2pForm): Record<string, string> {
  return {
    CustomerName: f.legalName,
    Street: f.street,
    City: f.city,
    Region: f.region,
    PostalCode: f.postalCode,
    IsoCountry: "US",
    FriendlyName: f.legalName,
  };
}

/** Compliance/Usa2p — the campaign; list values are sent as repeated fields */
export function campaignFields(
  f: A2pForm,
  brandSid: string,
): Record<string, string | string[]> {
  return {
    BrandRegistrationSid: brandSid,
    Description: f.description,
    MessageFlow: f.messageFlow,
    MessageSamples: f.samples,
    UsAppToPersonUsecase: f.useCase,
    HasEmbeddedLinks: String(f.hasEmbeddedLinks),
    HasEmbeddedPhone: String(f.hasEmbeddedPhone),
    OptInMessage: f.optInMessage,
    OptOutMessage: f.optOutMessage,
    HelpMessage: f.helpMessage,
    OptInKeywords: f.optInKeywords,
    OptOutKeywords: f.optOutKeywords,
    HelpKeywords: f.helpKeywords,
    SubscriberOptIn: "true",
    AgeGated: "false",
    DirectLending: "false",
    PrivacyPolicyUrl: PRIVACY_POLICY_URL,
    TermsAndConditionsUrl: SMS_TERMS_URL,
  };
}

interface EvaluationResult {
  passed?: boolean;
  friendly_name?: string;
  failure_reason?: string;
  invalid?: {
    object_field?: string;
    friendly_name?: string;
    failure_reason?: string;
    error_code?: number;
  }[];
}

/** a noncompliant evaluation's `results` → one error per failing field (or per failing requirement) */
export function evaluationErrors(step: A2pStep, results: unknown): A2pError[] {
  const out: A2pError[] = [];
  for (
    const r of (Array.isArray(results) ? results : []) as EvaluationResult[]
  ) {
    if (r.passed !== false) continue;
    const invalid = Array.isArray(r.invalid) ? r.invalid : [];
    if (!invalid.length) {
      out.push({
        step,
        message: `${r.friendly_name ?? "Requirement"}: ${
          r.failure_reason ?? "not met"
        }`,
      });
      continue;
    }
    for (const i of invalid) {
      out.push({
        step,
        ...(i.object_field ? { field: i.object_field } : {}),
        message: `${i.friendly_name ?? i.object_field ?? "Field"}: ${
          i.failure_reason ?? r.failure_reason ?? "invalid"
        }`,
        ...(typeof i.error_code === "number" ? { code: i.error_code } : {}),
      });
    }
  }
  return out;
}

// ── the one state, and the gate ──────────────────────────────────────────────

type Statuses = Partial<
  Pick<
    A2pRegistration,
    | "profileSid"
    | "profileStatus"
    | "trustProductStatus"
    | "brandSid"
    | "brandStatus"
    | "campaignSid"
    | "campaignStatus"
    | "needsIsvPrimary"
  >
>;

const BRAND_FAILED = new Set(["FAILED", "SUSPENDED", "DELETED"]);
const CAMPAIGN_FAILED = new Set(["FAILED", "EXPIRED"]);

/** profile → brand → campaign: the furthest step decides, a failure anywhere says so */
export function reduceA2pState(r: Statuses): A2pState {
  if (r.needsIsvPrimary) return "needs_isv_primary";
  if (!r.profileSid) return "none";
  if (
    r.profileStatus === "twilio-rejected" ||
    r.trustProductStatus === "twilio-rejected"
  ) return "profile_failed";
  if (r.campaignStatus === "VERIFIED") return "registered";
  if (r.campaignStatus && CAMPAIGN_FAILED.has(r.campaignStatus)) {
    return "campaign_failed";
  }
  if (r.campaignSid) return "campaign_pending";
  if (r.brandStatus && BRAND_FAILED.has(r.brandStatus)) return "brand_failed";
  if (r.brandStatus === "APPROVED") return "campaign_pending";
  if (r.brandSid) return "brand_pending";
  return "profile_pending";
}

/** a subaccount line may text only once its campaign is VERIFIED */
export function maySendFromSubaccount(
  reg: Pick<A2pRegistration, "campaignStatus"> | null | undefined,
): boolean {
  return reg?.campaignStatus === "VERIFIED";
}

/** REQ-920d — Not registered / In review / Registered / Failed (waiting on the platform's ISV profile is "not registered") */
export function a2pSummary(
  reg: Pick<A2pRegistration, "state"> | null | undefined,
): A2pSummary {
  if (!reg) return "none";
  switch (reg.state) {
    case "registered":
      return "registered";
    case "profile_failed":
    case "brand_failed":
    case "campaign_failed":
      return "failed";
    case "none":
    case "needs_isv_primary":
      return "none";
    default:
      return "pending";
  }
}
