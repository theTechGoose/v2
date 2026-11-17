/**
 * REQ-920 — Twilio's TrustHub + Messaging + Addresses REST, as far as the A2P
 * tests are concerned. Self-contained (no imports) so the int tests (through
 * `fetchOverride`), the module e2e and the browser story (on a port) share it.
 *
 * A test steers it through its public fields: whether the platform's primary
 * profile is ISV-type, the evaluation outcome, the statuses the GETs answer,
 * and `failNext` — "POST /v1/SupportingDocuments" → one refusal, then normal.
 */
export interface StandInCall {
  method: string;
  /** path + query, e.g. /v1/CustomerProfiles?Status=twilio-approved */
  path: string;
  form: URLSearchParams;
  /** the account SID the Basic auth names */
  account: string;
}

export interface StandInFailure {
  status: number;
  code: number;
  message: string;
}

const PRIMARY = "BUprimary0000000000000000000000000";
const PRIMARY_IT = "ITprimary0000000000000000000000000";

export class A2pStandIn {
  calls: StandInCall[] = [];
  /** the platform's approved profile is ISV Reseller or Partner */
  primaryIsIsv = true;
  /** what a customer-profile evaluation answers */
  profileEvaluation: "compliant" | "noncompliant" = "compliant";
  /** what GET on a submitted customer profile / trust product answers */
  profileStatus = "pending-review";
  trustProductStatus = "pending-review";
  /** what the brand GET answers (and the POST, at creation) */
  brandStatus = "PENDING";
  brandFailureReason = "";
  brandErrors: { code: number; description: string }[] = [];
  /** what the campaign POST and GET answer */
  campaignStatus = "PENDING";
  campaignErrors: { error_code: number; description: string }[] = [];
  /** "METHOD /path" (no query) → one refusal */
  failNext = new Map<string, StandInFailure>();
  readonly primarySid = PRIMARY;
  private n = 0;

  /** the routes; `null` when nothing here answers (a caller may chain another stand-in) */
  handle(
    method: string,
    pathWithQuery: string,
    form: URLSearchParams,
    account = "",
  ): { status: number; body: unknown } | null {
    const path = pathWithQuery.split("?")[0];
    const query = new URLSearchParams(pathWithQuery.split("?")[1] ?? "");
    const ok = (body: unknown, status = 201) => ({ status, body });
    const route = `${method} ${path}`;
    const isOurs = path.startsWith("/v1/") || /\/Addresses\.json$/.test(path);
    if (!isOurs) return null;
    this.calls.push({ method, path: pathWithQuery, form, account });
    const fail = this.failNext.get(route);
    if (fail) {
      this.failNext.delete(route);
      return {
        status: fail.status,
        body: { code: fail.code, message: fail.message, status: fail.status },
      };
    }
    const id = (prefix: string) =>
      `${prefix}${String(++this.n).padStart(32 - prefix.length + 2, "0")}`;

    // ── the platform's primary profile (main account) ──
    if (method === "GET" && path === "/v1/CustomerProfiles") {
      return ok({
        results: query.get("Status") === "twilio-approved"
          ? [{ sid: PRIMARY, status: "twilio-approved" }]
          : [],
        meta: {},
      }, 200);
    }
    if (
      method === "GET" &&
      path === `/v1/CustomerProfiles/${PRIMARY}/EntityAssignments`
    ) {
      return ok({
        results: [{ sid: "BVprimary", object_sid: PRIMARY_IT }],
        meta: {},
      }, 200);
    }
    if (method === "GET" && path === `/v1/EndUsers/${PRIMARY_IT}`) {
      return ok({
        sid: PRIMARY_IT,
        type: "customer_profile_business_information",
        attributes: {
          business_name: "MONSTER RESERVATIONS GROUP",
          business_identity: this.primaryIsIsv
            ? "isv_reseller_or_partner"
            : "direct_customer",
        },
      }, 200);
    }

    // ── bundles: customer profiles and trust products ──
    const bundle = path.match(
      /^\/v1\/(CustomerProfiles|TrustProducts)(?:\/(BU\w+))?(?:\/(EntityAssignments|Evaluations))?$/,
    );
    if (bundle) {
      const [, kind, sid, sub] = bundle;
      if (!sid && method === "POST") {
        return ok({
          sid: id("BU"),
          status: "draft",
          friendly_name: form.get("FriendlyName"),
          email: form.get("Email"),
        });
      }
      if (sid && sub === "EntityAssignments" && method === "POST") {
        return ok({ sid: id("BV"), object_sid: form.get("ObjectSid") });
      }
      if (sid && sub === "Evaluations" && method === "POST") {
        const compliant = kind === "TrustProducts" ||
          this.profileEvaluation === "compliant";
        return ok({
          sid: id("EL"),
          status: compliant ? "compliant" : "noncompliant",
          results: compliant ? [] : [{
            friendly_name: "Business Information",
            object_type: "customer_profile_business_information",
            passed: false,
            failure_reason: "Website URL is not reachable",
            invalid: [{
              friendly_name: "Website URL",
              object_field: "website_url",
              failure_reason: "Website URL is not reachable",
              error_code: 22217,
            }],
          }],
        });
      }
      if (sid && !sub && method === "POST") {
        return ok({ sid, status: form.get("Status") ?? "draft" }, 200);
      }
      if (sid && !sub && method === "GET") {
        const status = kind === "TrustProducts"
          ? this.trustProductStatus
          : this.profileStatus;
        return ok({
          sid,
          status,
          errors: status === "twilio-rejected"
            ? [{ code: 22216, message: "Business name does not match the EIN" }]
            : [],
        }, 200);
      }
    }

    // ── end users, supporting documents, addresses ──
    if (method === "POST" && path === "/v1/EndUsers") {
      return ok({
        sid: id("IT"),
        type: form.get("Type"),
        attributes: JSON.parse(form.get("Attributes") ?? "{}"),
      });
    }
    const endUser = path.match(/^\/v1\/EndUsers\/(IT\w+)$/);
    if (method === "POST" && endUser) {
      return ok({
        sid: endUser[1],
        attributes: JSON.parse(form.get("Attributes") ?? "{}"),
      }, 200);
    }
    if (method === "POST" && path === "/v1/SupportingDocuments") {
      return ok({
        sid: id("RD"),
        type: form.get("Type"),
        attributes: JSON.parse(form.get("Attributes") ?? "{}"),
      });
    }
    if (
      method === "POST" &&
      /^\/2010-04-01\/Accounts\/\w+\/Addresses\.json$/.test(path)
    ) {
      return ok({
        sid: id("AD"),
        customer_name: form.get("CustomerName"),
        iso_country: form.get("IsoCountry"),
      });
    }

    // ── brand, messaging service, campaign ──
    if (method === "POST" && path === "/v1/a2p/BrandRegistrations") {
      return ok({ sid: id("BN"), status: this.brandStatus });
    }
    const brand = path.match(/^\/v1\/a2p\/BrandRegistrations\/(BN\w+)$/);
    if (method === "GET" && brand) {
      return ok({
        sid: brand[1],
        status: this.brandStatus,
        brand_score: 42,
        failure_reason: this.brandFailureReason || null,
        errors: this.brandErrors,
      }, 200);
    }
    if (method === "POST" && path === "/v1/Services") {
      return ok({ sid: id("MG"), friendly_name: form.get("FriendlyName") });
    }
    const numbers = path.match(/^\/v1\/Services\/(MG\w+)\/PhoneNumbers$/);
    if (method === "POST" && numbers) {
      return ok({ sid: form.get("PhoneNumberSid"), service_sid: numbers[1] });
    }
    const campaigns = path.match(
      /^\/v1\/Services\/(MG\w+)\/Compliance\/Usa2p(?:\/(QE\w+))?$/,
    );
    if (campaigns && method === "POST" && !campaigns[2]) {
      return ok({
        sid: id("QE"),
        campaign_status: this.campaignStatus,
        errors: this.campaignErrors,
      });
    }
    if (campaigns && method === "GET" && campaigns[2]) {
      return ok({
        sid: campaigns[2],
        campaign_status: this.campaignStatus,
        errors: this.campaignErrors,
      }, 200);
    }

    return ok(
      { code: 20404, message: `a2p stand-in: no route for ${route}` },
      404,
    );
  }

  /** the stand-in as a `fetch` (int tests: TrustHubClient.fetchOverride) */
  fetch: typeof fetch = async (input, init) => {
    const u = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url,
    );
    const body = typeof init?.body === "string" ? init.body : "";
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const account = auth.startsWith("Basic ")
      ? atob(auth.slice(6)).split(":")[0]
      : "";
    const res = this.handle(
      init?.method ?? "GET",
      u.pathname + u.search,
      new URLSearchParams(body),
      account,
    ) ??
      { status: 404, body: { code: 20404, message: "not an a2p route" } };
    return await Promise.resolve(
      new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { "content-type": "application/json" },
      }),
    );
  };

  /** "METHOD /path" for every call, in order (query dropped) */
  ops(): string[] {
    return this.calls.map((c) =>
      `${c.method} ${
        c.path.split("?")[0].replace(/(BU|IT|BV|EL|RD|AD|BN|MG|QE)\w+/g, "$1…")
      }`
    );
  }
}

/** a form that passes every rule (REQ-920a) */
export const VALID_A2P_FORM = {
  legalName: "Bright Shine Cleaning LLC",
  ein: "12-3456789",
  businessType: "Limited Liability Corporation",
  industry: "PROFESSIONAL_SERVICES",
  website: "https://brightshine.example.com",
  socialUrls: "",
  companyType: "private",
  repFirstName: "Dana",
  repLastName: "Reyes",
  repEmail: "dana@brightshine.example.com",
  repPhone: "(843) 555-0142",
  repTitle: "Owner",
  repPosition: "CEO",
  street: "100 Ocean Blvd",
  city: "Myrtle Beach",
  region: "SC",
  postalCode: "29577",
  useCase: "CUSTOMER_CARE",
  description:
    "Appointment confirmations, schedule changes and replies to customers who contacted Bright Shine Cleaning.",
  messageFlow:
    "Customers give their mobile number on our booking form or by calling us and agree to receive texts about their cleaning appointments.",
  samples: [
    "Hi Sam, this is Bright Shine Cleaning: your cleaning is confirmed for Tuesday at 9am. Reply STOP to opt out.",
    "Bright Shine Cleaning: our crew is on the way and will arrive in about 20 minutes. Reply HELP for help.",
  ],
  optInMessage:
    "Bright Shine Cleaning: you're subscribed to appointment texts. Msg & data rates may apply. Reply STOP to opt out.",
  optOutMessage:
    "Bright Shine Cleaning: you're unsubscribed and will get no more texts. Reply START to resubscribe.",
  helpMessage:
    "Bright Shine Cleaning: for help call (843) 555-0142 or email dana@brightshine.example.com. Reply STOP to opt out.",
  hasEmbeddedLinks: false,
  hasEmbeddedPhone: true,
};
