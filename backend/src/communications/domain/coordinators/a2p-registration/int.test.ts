/**
 * REQ-920a/c — the ISV walk on the line's subaccount against a TrustHub /
 * Messaging stand-in: the happy path to VERIFIED across refreshes, a FAILED
 * brand's errors, the ISV prerequisite (and its resume), a mid-way refusal
 * that resumes without re-creating anything, a noncompliant evaluation.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertRejects } from "#std/assert";
import { freshLine, stores } from "../_test-support/mod.ts";
import { A2pStandIn, VALID_A2P_FORM } from "../_test-support/a2p-stand-in.ts";
import { TrustHubClient } from "@communications/domain/data/trusthub-client/mod.ts";
import { A2pStore } from "@communications/domain/data/a2p-store/mod.ts";
import { parseA2pForm } from "@communications/domain/business/a2p/mod.ts";
import type { CommsConfigSource } from "@communications/domain/data/config/mod.ts";
import type { LineStore } from "@communications/domain/data/line-store/mod.ts";
import { NoLineError } from "@communications/domain/coordinators/line-context/mod.ts";
import { A2pHouseLineError, A2pRegistrations } from "./mod.ts";

const SUB = "ACsub920";
const FORM = parseA2pForm(VALID_A2P_FORM);

async function setup(overrides: Record<string, string | undefined> = {}) {
  const { restore, cfg } = await freshLine(overrides);
  const s = await stores();
  const line = await s.lines.create({
    userId: "u_920",
    subaccountSid: SUB,
    number: "+18435550920",
    numberSid: "PNsub920",
    apiKeySid: "SKsub920",
    twimlAppSid: "APsub920",
    authToken: "sub920-token",
    apiKeySecret: "sub920-secret",
  });
  const stand = new A2pStandIn();
  const client = new TrustHubClient(cfg as CommsConfigSource);
  client.fetchOverride = stand.fetch;
  const store = new A2pStore();
  const a2p = new A2pRegistrations(client, store, s.lines as LineStore, cfg);
  return { restore, cfg, stand, a2p, store, line, lines: s.lines };
}

const formOf = (stand: A2pStandIn, op: string) =>
  stand.calls.find((c) => `${c.method} ${c.path.split("?")[0]}` === op)?.form;

Deno.test("REQ-920a a2p int: start walks profile → trust product → brand → service on the SUBACCOUNT, refreshes carry it to VERIFIED", async () => {
  const { restore, stand, a2p, store, line } = await setup();
  try {
    assertEquals(await a2p.get("u_920"), null);
    const reg = await a2p.start("u_920", FORM);
    assertEquals(stand.ops(), [
      "POST /v1/CustomerProfiles",
      "POST /v1/EndUsers",
      "POST /v1/CustomerProfiles/BU…/EntityAssignments",
      "POST /v1/EndUsers",
      "POST /v1/CustomerProfiles/BU…/EntityAssignments",
      `POST /2010-04-01/Accounts/${SUB}/Addresses.json`,
      "POST /v1/SupportingDocuments",
      "POST /v1/CustomerProfiles/BU…/EntityAssignments",
      "GET /v1/CustomerProfiles",
      "GET /v1/CustomerProfiles/BU…/EntityAssignments",
      "GET /v1/EndUsers/IT…",
      "POST /v1/CustomerProfiles/BU…/EntityAssignments",
      "POST /v1/CustomerProfiles/BU…/Evaluations",
      "POST /v1/CustomerProfiles/BU…",
      "POST /v1/TrustProducts",
      "POST /v1/EndUsers",
      "POST /v1/TrustProducts/BU…/EntityAssignments",
      "POST /v1/TrustProducts/BU…/EntityAssignments",
      "POST /v1/TrustProducts/BU…/Evaluations",
      "POST /v1/TrustProducts/BU…",
      "POST /v1/a2p/BrandRegistrations",
      "POST /v1/Services",
      "POST /v1/Services/MG…/PhoneNumbers",
    ]);
    // the primary-profile lookup is the MAIN account's; everything else the subaccount's
    const lookups = stand.calls.filter((c) => c.method === "GET");
    assertEquals(lookups.map((c) => c.account), ["ACtest", "ACtest", "ACtest"]);
    assertEquals(
      lookups[0].path,
      "/v1/CustomerProfiles?Status=twilio-approved&PageSize=50",
    );
    assert(
      stand.calls.filter((c) => c.method === "POST").every((c) =>
        c.account === SUB
      ),
      "every write is on the subaccount",
    );

    const profile = formOf(stand, "POST /v1/CustomerProfiles")!;
    assertEquals(
      profile.get("PolicySid"),
      "RNdfbf3fae0e1107f8aded0e7cead80bf5",
    );
    assertEquals(profile.get("Email"), "hello@documonster.com");
    assertEquals(
      profile.get("StatusCallback"),
      "https://api.test/communications/twilio/a2p-status",
    );
    const business = stand.calls.find((c) =>
      c.form.get("Type") === "customer_profile_business_information"
    )!;
    assertEquals(
      JSON.parse(business.form.get("Attributes")!).business_registration_number,
      "123456789",
    );
    const rep = stand.calls.find((c) =>
      c.form.get("Type") === "authorized_representative_1"
    )!;
    assertEquals(
      JSON.parse(rep.form.get("Attributes")!).phone_number,
      "+18435550142",
    );
    assertEquals(
      formOf(stand, `POST /2010-04-01/Accounts/${SUB}/Addresses.json`)!.get(
        "IsoCountry",
      ),
      "US",
    );
    const doc = formOf(stand, "POST /v1/SupportingDocuments")!;
    assertEquals(doc.get("Type"), "customer_profile_address");
    assertEquals(JSON.parse(doc.get("Attributes")!), {
      address_sids: reg.addressSid,
    });
    const assigns = stand.calls.filter((c) =>
      c.path.startsWith(
        `/v1/CustomerProfiles/${reg.profileSid}/EntityAssignments`,
      )
    ).map((c) => c.form.get("ObjectSid") ?? undefined);
    assertEquals(assigns, [
      reg.businessEndUserSid,
      reg.repEndUserSid,
      reg.addressDocSid,
      stand.primarySid,
    ]);
    assertEquals(
      stand.calls.find((c) =>
        c.path === `/v1/CustomerProfiles/${reg.profileSid}`
      )!.form.get("Status"),
      "pending-review",
    );
    const tp = formOf(stand, "POST /v1/TrustProducts")!;
    assertEquals(tp.get("PolicySid"), "RNb0d4771c2c98518d916a3d4cd70a8f8b");
    const msgProfile = stand.calls.find((c) =>
      c.form.get("Type") === "us_a2p_messaging_profile_information"
    )!;
    assertEquals(JSON.parse(msgProfile.form.get("Attributes")!), {
      company_type: "private",
    });
    const tpAssigns = stand.calls.filter((c) =>
      c.path === `/v1/TrustProducts/${reg.trustProductSid}/EntityAssignments`
    ).map((c) => c.form.get("ObjectSid") ?? undefined);
    assertEquals(tpAssigns, [reg.messagingEndUserSid, reg.profileSid]);
    const brand = formOf(stand, "POST /v1/a2p/BrandRegistrations")!;
    assertEquals([
      brand.get("CustomerProfileBundleSid"),
      brand.get("A2PProfileBundleSid"),
      brand.get("SkipAutomaticSecVet"),
    ], [reg.profileSid, reg.trustProductSid, "true"]);
    const svc = formOf(stand, "POST /v1/Services")!;
    assertEquals(svc.get("FriendlyName"), "documonster:u_920");
    assertEquals(
      svc.get("InboundRequestUrl"),
      "https://api.test/communications/twilio/sms",
    );
    assertEquals(
      svc.get("StatusCallback"),
      "https://api.test/communications/twilio/sms-status",
    );
    assertEquals(svc.get("UseInboundWebhookOnNumber"), "false");
    assertEquals(stand.calls.at(-1)!.form.get("PhoneNumberSid"), "PNsub920");

    assertEquals(reg.state, "brand_pending");
    assertEquals(reg.brandStatus, "PENDING");
    assertEquals(reg.errors, []);
    assertEquals(
      (await store.get(line.id))?.brandSid,
      reg.brandSid,
      "persisted by line id",
    );

    // brand still pending: no campaign yet
    const n = stand.calls.length;
    const r1 = (await a2p.refresh("u_920"))!;
    assertEquals(r1.state, "brand_pending");
    assertEquals(stand.ops().slice(n), [
      "GET /v1/CustomerProfiles/BU…",
      "GET /v1/TrustProducts/BU…",
      "GET /v1/a2p/BrandRegistrations/BN…",
    ]);

    // the brand is approved: the campaign is filed in the same refresh
    stand.brandStatus = "APPROVED";
    stand.profileStatus = "twilio-approved";
    stand.trustProductStatus = "twilio-approved";
    const r2 = (await a2p.refresh("u_920"))!;
    assertEquals(r2.state, "campaign_pending");
    const camp = stand.calls.find((c) =>
      c.path === `/v1/Services/${r2.serviceSid}/Compliance/Usa2p`
    )!.form;
    assertEquals(camp.get("BrandRegistrationSid"), r2.brandSid);
    assertEquals(camp.get("UsAppToPersonUsecase"), "CUSTOMER_CARE");
    assertEquals(camp.getAll("MessageSamples"), VALID_A2P_FORM.samples);
    assertEquals(camp.getAll("OptOutKeywords"), ["STOP"]);
    assertEquals(
      camp.get("PrivacyPolicyUrl"),
      "https://documonster.com/privacy",
    );

    stand.campaignStatus = "VERIFIED";
    const r3 = (await a2p.refresh("u_920"))!;
    assertEquals(r3.state, "registered");
    assertEquals(r3.campaignStatus, "VERIFIED");
    assertEquals((await a2p.get("u_920"))?.state, "registered");
    assertEquals(
      stand.calls.filter((c) =>
        c.path.endsWith("/Compliance/Usa2p")
      ).length,
      1,
      "the campaign is filed once",
    );
  } finally {
    await restore();
  }
});

Deno.test("REQ-920a a2p int: a FAILED brand surfaces Twilio's reason and errors, and no campaign is filed", async () => {
  const { restore, stand, a2p } = await setup();
  try {
    await a2p.start("u_920", FORM);
    stand.brandStatus = "FAILED";
    stand.brandFailureReason = "TCR rejected the brand";
    stand.brandErrors = [{
      code: 30794,
      description: "EIN does not match the legal name",
    }];
    const reg = (await a2p.refresh("u_920"))!;
    assertEquals(reg.state, "brand_failed");
    assertEquals(reg.errors, [
      { step: "brand", message: "TCR rejected the brand" },
      {
        step: "brand",
        message: "EIN does not match the legal name",
        code: 30794,
      },
    ]);
    assertEquals(
      stand.calls.some((c) => c.path.endsWith("/Compliance/Usa2p")),
      false,
    );
  } finally {
    await restore();
  }
});

Deno.test("REQ-920c a2p int: no ISV-type primary profile → needs_isv_primary after the address step; it resumes once Twilio marks it ISV", async () => {
  const { restore, stand, a2p } = await setup();
  try {
    stand.primaryIsIsv = false;
    const reg = await a2p.start("u_920", FORM);
    assertEquals(reg.state, "needs_isv_primary");
    assertEquals(reg.needsIsvPrimary, true);
    assert(
      reg.profileSid && reg.businessEndUserSid && reg.repEndUserSid &&
        reg.addressDocSid,
      "everything up to the address is done",
    );
    assertEquals(stand.ops().at(-1), "GET /v1/EndUsers/IT…");
    assertEquals(
      stand.calls.some((c) =>
        c.path.includes("/Evaluations") || c.path.includes("BrandRegistrations")
      ),
      false,
    );
    assertEquals(reg.form.legalName, FORM.legalName, "the form is saved");

    stand.primaryIsIsv = true;
    const n = stand.calls.length;
    const next = (await a2p.refresh("u_920"))!;
    assertEquals(next.state, "brand_pending");
    assertEquals(next.needsIsvPrimary, false);
    assertEquals(
      stand.calls.slice(n).filter((c) =>
        c.method === "POST" &&
        (/^\/v1\/(CustomerProfiles|SupportingDocuments)$/.test(c.path) ||
          c.path.endsWith("/Addresses.json") ||
          (c.path === "/v1/EndUsers" &&
            c.form.get("Type") !== "us_a2p_messaging_profile_information"))
      ).length,
      0,
      "nothing made twice",
    );
  } finally {
    await restore();
  }
});

Deno.test("REQ-920c a2p int: COMMS_A2P_PRIMARY_PROFILE_SID skips the lookup", async () => {
  const { restore, stand, a2p } = await setup({
    COMMS_A2P_PRIMARY_PROFILE_SID: "BUconfigured000000000000000000000",
  });
  try {
    const reg = await a2p.start("u_920", FORM);
    assertEquals(stand.calls.some((c) => c.method === "GET"), false);
    assertEquals(
      stand.calls.filter((c) =>
        c.path === `/v1/CustomerProfiles/${reg.profileSid}/EntityAssignments`
      ).at(-1)!.form.get("ObjectSid"),
      "BUconfigured000000000000000000000",
    );
  } finally {
    await restore();
  }
});

Deno.test("REQ-920a a2p int: a refusal mid-way is saved with its code; the next run resumes at that step without re-creating anything", async () => {
  const { restore, stand, a2p } = await setup();
  try {
    stand.failNext.set("POST /v1/SupportingDocuments", {
      status: 400,
      code: 22103,
      message: "Invalid address",
    });
    const reg = await a2p.start("u_920", FORM);
    assertEquals(reg.errors, [{
      step: "profile",
      message: "Invalid address",
      code: 22103,
    }]);
    assertEquals(reg.state, "profile_pending");
    assert(reg.addressSid && !reg.addressDocSid);
    const resumed = await a2p.start("u_920", FORM);
    assertEquals(resumed.errors, []);
    assertEquals(resumed.state, "brand_pending");
    const count = (op: string) => stand.ops().filter((o) => o === op).length;
    assertEquals(count("POST /v1/CustomerProfiles"), 1);
    assertEquals(count(`POST /2010-04-01/Accounts/${SUB}/Addresses.json`), 1);
    assertEquals(count("POST /v1/SupportingDocuments"), 2);
    assertEquals(resumed.profileSid, reg.profileSid);
  } finally {
    await restore();
  }
});

Deno.test("REQ-920a a2p int: a noncompliant evaluation names the failing field and does not submit; a corrected form updates the end user", async () => {
  const { restore, stand, a2p } = await setup();
  try {
    stand.profileEvaluation = "noncompliant";
    const reg = await a2p.start("u_920", FORM);
    assertEquals(reg.errors, [{
      step: "profile",
      field: "website_url",
      message: "Website URL: Website URL is not reachable",
      code: 22217,
    }]);
    assertEquals(reg.profileSubmitted, undefined);
    assertEquals(
      stand.calls.some((c) =>
        c.path === `/v1/CustomerProfiles/${reg.profileSid}` &&
        c.method === "POST"
      ),
      false,
    );

    stand.profileEvaluation = "compliant";
    const fixed = await a2p.start(
      "u_920",
      parseA2pForm({
        ...VALID_A2P_FORM,
        website: "https://brightshine.example.org",
      }),
    );
    const update = stand.calls.find((c) =>
      c.path === `/v1/EndUsers/${reg.businessEndUserSid}`
    )!;
    assertEquals(
      JSON.parse(update.form.get("Attributes")!).website_url,
      "https://brightshine.example.org",
    );
    assertEquals(fixed.state, "brand_pending");
  } finally {
    await restore();
  }
});

Deno.test("REQ-920a a2p int: no line → 409 no_line; the env line's owner → 409 a2p_house_line (the house path registers it)", async () => {
  const { restore, a2p } = await setup({ COMMS_ENV_LINE_OWNER: "u_owner" });
  try {
    await assertRejects(() => a2p.start("u_nobody", FORM), NoLineError);
    const e = await assertRejects(
      () => a2p.start("u_owner", FORM),
      A2pHouseLineError,
    );
    assertEquals([e.status, e.code], [409, "a2p_house_line"]);
    assertEquals(await a2p.get("u_nobody"), null);
  } finally {
    await restore();
  }
});

Deno.test("REQ-920d a2p int: a house line (kind main, REQ-920b) → 409 a2p_house_line, nothing walked on Twilio", async () => {
  const { restore, a2p, stand, line, lines } = await setup();
  try {
    await (lines as LineStore).markMain(line.id, {
      apiKeySid: "SKmain920",
      apiKeySecret: "main920-secret",
      twimlAppSid: "APmain920",
      messagingServiceSid: "MGhouse920",
      campaignUsecase: "MIXED",
    });
    const e = await assertRejects(
      () => a2p.start("u_920", FORM),
      A2pHouseLineError,
    );
    assertEquals([e.status, e.code], [409, "a2p_house_line"]);
    assertEquals(stand.calls.length, 0);
  } finally {
    await restore();
  }
});
