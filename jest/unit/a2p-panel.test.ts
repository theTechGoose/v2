/**
 * REQ-920a/c/e — the Phone page's Texting registration panel (A2P 10DLC): the component and its
 * mount, the client's three calls, the pure helpers in lib/a2p.ts (form rules, the status strip,
 * the headline, the gate refusal, Twilio's field errors), and both dictionaries.
 */
import * as fs from "fs";
import * as path from "path";
import {
  a2pFieldErrors,
  a2pHeadline,
  BUSINESS_TYPES,
  defaultCopy,
  emptyA2pForm,
  formFromRegistration,
  INDUSTRIES,
  isA2pRefusal,
  JOB_POSITIONS,
  stepStatuses,
  toA2pBody,
  USE_CASES,
  validateA2pForm,
} from "../../front-end/lib/a2p";
import { commsClient } from "../../front-end/clients/communications";
import { ApiError } from "../../front-end/lib/api";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dict = (rel: string) => JSON.parse(read(rel)) as Record<string, string>;

type Captured = { method: string; url: string; body: unknown };
function captureFetch(answer: unknown = {}): Captured[] {
  const seen: Captured[] = [];
  (globalThis as { fetch: unknown }).fetch = (
    url: string,
    init: { method: string; body?: string },
  ) => {
    seen.push({
      method: init.method,
      url: String(url),
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(
      {
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(answer)),
      } as unknown as Response,
    );
  };
  return seen;
}

const filled = () => ({
  ...emptyA2pForm(),
  legalName: "Bright Shine Cleaning LLC",
  ein: "12-3456789",
  businessType: "Limited Liability Corporation",
  industry: "PROFESSIONAL_SERVICES",
  website: "https://brightshine.example.com",
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
  description:
    "Appointment confirmations and replies to customers who contacted Bright Shine Cleaning.",
  messageFlow:
    "Customers give their number on our booking form and agree to receive texts about their appointments.",
  samples: [
    "Bright Shine Cleaning: your cleaning is confirmed for Tuesday at 9am. Reply STOP to opt out.",
    "Bright Shine Cleaning: our crew is on the way, about 20 minutes out.",
    "",
    "",
    "",
  ],
  ...defaultCopy("Bright Shine Cleaning LLC", "(843) 555-0142"),
});

describe("REQ-920 the Texting registration panel", () => {
  test("REQ-920a the panel groups Business / Representative / Address / Messaging, shows the strip, Check status, the fee note; PhonePage mounts it under the line card", () => {
    const src = read("front-end/components/comms/A2pPanel.tsx");
    for (
      const cy of [
        "a2p-panel",
        "a2p-state",
        "a2p-strip",
        "a2p-step",
        "a2p-check",
        "a2p-errors",
        "a2p-isv",
        "a2p-fees",
        "a2p-form",
        "a2p-group-business",
        "a2p-group-rep",
        "a2p-group-address",
        "a2p-group-messaging",
        "a2p-submit",
      ]
    ) expect(src).toContain(`data-cy="${cy}`);
    expect(src).toContain("commsClient.a2p(");
    expect(src).toContain("commsClient.a2pSubmit(");
    expect(src).toContain("commsClient.a2pRefresh(");
    const page = read("front-end/islands/PhonePage.tsx");
    expect(page).toContain(
      'import A2pPanel from "../components/comms/A2pPanel.tsx";',
    );
    expect(page).toContain("<A2pPanel line={line} />");
    expect(page.indexOf('data-cy="comms-line"')).toBeLessThan(
      page.indexOf("<A2pPanel"),
    );
    // the gate's refusal reaches the person as one line
    expect(page).toContain("isA2pRefusal(e)");
    expect(read("front-end/static/phone.css")).toContain(".a2p-strip");
  });

  test("REQ-920a the client: GET /communications/a2p, POST the form, POST refresh", async () => {
    const seen = captureFetch({ registration: null });
    await commsClient.a2p();
    await commsClient.a2pSubmit(toA2pBody(filled()));
    await commsClient.a2pRefresh();
    expect(
      seen.map((s) =>
        `${s.method} ${s.url.replace("http://localhost:3000", "")}`
      ),
    ).toEqual([
      "GET /communications/a2p",
      "POST /communications/a2p",
      "POST /communications/a2p/refresh",
    ]);
    const body = seen[1].body as Record<string, unknown>;
    expect(body.legalName).toBe("Bright Shine Cleaning LLC");
    expect(body.samples).toHaveLength(2);
  });

  test("REQ-920a the form's rules mirror the server's: required, EIN, URL, ZIP, state, 2–5 samples, copy lengths", () => {
    expect(validateA2pForm(filled())).toEqual({});
    const empty = validateA2pForm(emptyA2pForm());
    for (
      const f of [
        "legalName",
        "ein",
        "businessType",
        "industry",
        "website",
        "repFirstName",
        "repEmail",
        "repPhone",
        "street",
        "postalCode",
        "description",
        "messageFlow",
        "samples",
      ]
    ) {
      expect(empty[f]).toBeTruthy();
    }
    const bad = validateA2pForm({
      ...filled(),
      ein: "12-34",
      website: "brightshine",
      postalCode: "2957",
      region: "Carolina",
      samples: ["just one sample, long enough", "", "", "", ""],
      optOutMessage: "STOP",
    });
    expect(Object.keys(bad).sort()).toEqual([
      "ein",
      "optOutMessage",
      "postalCode",
      "region",
      "samples",
      "website",
    ]);
    expect(bad.ein).toBe("comms.a2p.err.ein");
    expect(validateA2pForm({ ...filled(), companyType: "public" })).toEqual({
      stockExchange: "comms.a2p.err.required",
      stockTicker: "comms.a2p.err.required",
    });
    expect(toA2pBody(filled()).samples).toEqual(filled().samples.slice(0, 2));
  });

  test("REQ-920a suggested opt-in / opt-out / help wording names the business and the keywords", () => {
    const c = defaultCopy("Bright Shine", "(843) 555-0142");
    expect(c.optInMessage).toContain("Bright Shine");
    expect(c.optOutMessage).toContain("START");
    expect(c.helpMessage).toContain("(843) 555-0142");
    for (const m of Object.values(c)) {
      expect(m.length).toBeGreaterThanOrEqual(20);
      expect(m.length).toBeLessThanOrEqual(320);
    }
  });

  test("REQ-920a the lists match Twilio's values", () => {
    expect(BUSINESS_TYPES).toContain("Limited Liability Corporation");
    expect(BUSINESS_TYPES).toHaveLength(6);
    expect(INDUSTRIES).toContain("CONSTRUCTION");
    expect(JOB_POSITIONS).toEqual([
      "Director",
      "GM",
      "VP",
      "CEO",
      "CFO",
      "General Counsel",
      "Other",
    ]);
    expect(USE_CASES[0]).toBe("CUSTOMER_CARE");
  });

  test("REQ-920a the strip: profile → brand → campaign, each todo / pending / ok / failed; the headline", () => {
    expect(stepStatuses(null)).toEqual({
      profile: "todo",
      brand: "todo",
      campaign: "todo",
    });
    expect(stepStatuses({ profileSid: "BU1", profileStatus: "draft" })).toEqual(
      { profile: "todo", brand: "todo", campaign: "todo" },
    );
    expect(
      stepStatuses({
        profileSid: "BU1",
        profileSubmitted: true,
        profileStatus: "pending-review",
        brandSid: "BN1",
        brandStatus: "PENDING",
      }),
    ).toEqual({ profile: "pending", brand: "pending", campaign: "todo" });
    expect(
      stepStatuses({
        profileSid: "BU1",
        profileSubmitted: true,
        profileStatus: "twilio-approved",
        brandSid: "BN1",
        brandStatus: "APPROVED",
        campaignSid: "QE1",
        campaignStatus: "VERIFIED",
      }),
    ).toEqual({ profile: "ok", brand: "ok", campaign: "ok" });
    expect(
      stepStatuses({
        profileSid: "BU1",
        profileSubmitted: true,
        profileStatus: "twilio-rejected",
        brandSid: "BN1",
        brandStatus: "FAILED",
      }),
    ).toEqual({ profile: "failed", brand: "failed", campaign: "todo" });
    expect(
      stepStatuses({ campaignSid: "QE1", campaignStatus: "FAILED" }).campaign,
    ).toBe("failed");
    expect(a2pHeadline(null)).toBe("none");
    expect(a2pHeadline({ state: "none" })).toBe("none");
    expect(a2pHeadline({ state: "needs_isv_primary" })).toBe("needs_isv");
    expect(a2pHeadline({ state: "profile_pending" })).toBe("pending");
    expect(a2pHeadline({ state: "brand_pending" })).toBe("pending");
    expect(a2pHeadline({ state: "campaign_pending" })).toBe("pending");
    expect(a2pHeadline({ state: "brand_failed" })).toBe("failed");
    expect(a2pHeadline({ state: "registered" })).toBe("registered");
  });

  test("REQ-920a the gate's 403 is recognised; a 400 a2p_invalid becomes per-field messages; a saved form refills the panel", () => {
    expect(isA2pRefusal(new ApiError(403, { code: "a2p_unregistered" }))).toBe(
      true,
    );
    expect(isA2pRefusal(new ApiError(403, { code: "other" }))).toBe(false);
    expect(isA2pRefusal(new Error("x"))).toBe(false);
    expect(
      a2pFieldErrors(
        new ApiError(400, {
          code: "a2p_invalid",
          fields: [{ field: "ein", message: "bad ein" }],
        }),
      ),
    ).toEqual({ ein: "bad ein" });
    expect(a2pFieldErrors(new ApiError(500, {}))).toEqual({});
    const back = formFromRegistration({
      form: {
        ...toA2pBody(filled()),
        optInKeywords: ["START"],
        optOutKeywords: ["STOP"],
        helpKeywords: ["HELP"],
      },
    });
    expect(back.legalName).toBe("Bright Shine Cleaning LLC");
    expect(back.samples).toHaveLength(5);
    expect(back.samples[0]).toBe(filled().samples[0]);
  });

  test("REQ-920c/e both dictionaries carry every comms.a2p.* key, the ISV prerequisite in one line, the fee note", () => {
    const en = dict("lang/en.json"), es = dict("lang/es.json");
    const enKeys = Object.keys(en).filter((k) => k.startsWith("comms.a2p."));
    const esKeys = Object.keys(es).filter((k) => k.startsWith("comms.a2p."));
    expect(enKeys.length).toBeGreaterThanOrEqual(60);
    expect(esKeys.sort()).toEqual([...enKeys].sort());
    for (const k of enKeys) expect(es[k].trim()).toBeTruthy();
    expect(en["comms.a2p.isv"]).toBe(
      "Twilio has to mark the platform's business profile as ISV Reseller or Partner before customer lines can be registered.",
    );
    expect(en["comms.a2p.fees"]).toMatch(/Twilio bills/);
    expect(en["comms.a2p.fees"]).not.toMatch(/\$\d/);
    expect(en["comms.a2p.err.unregistered"]).toBeTruthy();
    for (const s of ["none", "pending", "registered", "failed"]) {
      expect(en[`comms.a2p.sys.${s}`]).toBeTruthy();
    }
    // every list value the panel offers has a label in both
    for (const v of INDUSTRIES) {
      expect(es[`comms.a2p.industry.${v}`]).toBeTruthy();
    }
    for (const v of USE_CASES) {
      expect(es[`comms.a2p.useCase.${v}`]).toBeTruthy();
    }
    // appended at the end: the last key of each dictionary is one of ours
    expect(Object.keys(en).at(-1)!.startsWith("comms.a2p.")).toBe(true);
    expect(Object.keys(es).at(-1)!.startsWith("comms.a2p.")).toBe(true);
  });
});
