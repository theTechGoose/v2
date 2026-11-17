/** REQ-920a — the A2P form → Twilio's attributes, the status reduction, and the texting gate (pure). */
import { assertEquals, assertThrows } from "#std/assert";
import { VALID_A2P_FORM } from "@communications/domain/coordinators/_test-support/a2p-stand-in.ts";
import {
  A2pFormError,
  a2pSummary,
  addressFields,
  businessAttributes,
  campaignFields,
  evaluationErrors,
  maySendFromSubaccount,
  messagingProfileAttributes,
  parseA2pForm,
  reduceA2pState,
  representativeAttributes,
} from "./mod.ts";

const fieldsOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof A2pFormError) return e.fields.map((f) => f.field).sort();
    throw e;
  }
  return [];
};

Deno.test("REQ-920a parseA2pForm: a valid form normalizes (EIN digits, E.164 rep phone, keywords defaulted, trimmed)", () => {
  const f = parseA2pForm({
    ...VALID_A2P_FORM,
    legalName: "  Bright Shine Cleaning LLC ",
    ein: "12-3456789",
  });
  assertEquals(f.legalName, "Bright Shine Cleaning LLC");
  assertEquals(f.ein, "123456789");
  assertEquals(f.repPhone, "+18435550142");
  assertEquals(f.optInKeywords, ["START"]);
  assertEquals(f.optOutKeywords, ["STOP"]);
  assertEquals(f.helpKeywords, ["HELP"]);
  assertEquals(f.samples.length, 2);
  assertEquals(f.region, "SC");
});

Deno.test("REQ-920a parseA2pForm: every broken field is named at once (400 a2p_invalid)", () => {
  const err = assertThrows(() => parseA2pForm({}), A2pFormError);
  assertEquals(err.status, 400);
  assertEquals(err.code, "a2p_invalid");
  const bad = fieldsOf(() =>
    parseA2pForm({
      ...VALID_A2P_FORM,
      ein: "12-34",
      businessType: "Sole Trader",
      industry: "SPACESHIPS",
      website: "brightshine",
      repEmail: "nope",
      repPhone: "12",
      repPosition: "Boss",
      region: "South Carolina",
      postalCode: "2957",
      useCase: "SPAM",
      description: "too short",
      messageFlow: "short",
      samples: ["one sample that is long enough"],
      optOutMessage: "STOP",
    })
  );
  assertEquals(bad, [
    "businessType",
    "description",
    "ein",
    "industry",
    "messageFlow",
    "optOutMessage",
    "postalCode",
    "region",
    "repEmail",
    "repPhone",
    "repPosition",
    "samples",
    "useCase",
    "website",
  ]);
});

Deno.test("REQ-920a parseA2pForm: samples are 2–5 of 20–1024 chars; a public company needs its exchange and ticker", () => {
  const long = "x".repeat(25);
  assertEquals(
    fieldsOf(() =>
      parseA2pForm({
        ...VALID_A2P_FORM,
        samples: [long, long, long, long, long, long],
      })
    ),
    ["samples"],
  );
  assertEquals(
    fieldsOf(() =>
      parseA2pForm({ ...VALID_A2P_FORM, samples: [long, "short"] })
    ),
    ["samples"],
  );
  assertEquals(
    fieldsOf(() => parseA2pForm({ ...VALID_A2P_FORM, companyType: "public" })),
    ["stockExchange", "stockTicker"],
  );
  const pub = parseA2pForm({
    ...VALID_A2P_FORM,
    companyType: "public",
    stockExchange: "nasdaq",
    stockTicker: "bsc",
  });
  assertEquals([pub.stockExchange, pub.stockTicker], ["NASDAQ", "BSC"]);
});

Deno.test("REQ-920a the Twilio attributes: business (direct_customer, EIN, USA_AND_CANADA), representative, messaging profile, address", () => {
  const f = parseA2pForm(VALID_A2P_FORM);
  assertEquals(businessAttributes(f), {
    business_name: "Bright Shine Cleaning LLC",
    business_identity: "direct_customer",
    business_type: "Limited Liability Corporation",
    business_industry: "PROFESSIONAL_SERVICES",
    business_registration_identifier: "EIN",
    business_registration_number: "123456789",
    business_regions_of_operation: "USA_AND_CANADA",
    website_url: "https://brightshine.example.com",
  });
  assertEquals(
    businessAttributes(
      parseA2pForm({
        ...VALID_A2P_FORM,
        socialUrls: "https://facebook.com/brightshine",
      }),
    ).social_media_profile_urls,
    "https://facebook.com/brightshine",
  );
  assertEquals(representativeAttributes(f), {
    first_name: "Dana",
    last_name: "Reyes",
    email: "dana@brightshine.example.com",
    phone_number: "+18435550142",
    business_title: "Owner",
    job_position: "CEO",
  });
  assertEquals(messagingProfileAttributes(f), { company_type: "private" });
  assertEquals(
    messagingProfileAttributes(
      parseA2pForm({
        ...VALID_A2P_FORM,
        companyType: "public",
        stockExchange: "NYSE",
        stockTicker: "BSC",
      }),
    ),
    { company_type: "public", stock_exchange: "NYSE", stock_ticker: "BSC" },
  );
  assertEquals(addressFields(f), {
    CustomerName: "Bright Shine Cleaning LLC",
    Street: "100 Ocean Blvd",
    City: "Myrtle Beach",
    Region: "SC",
    PostalCode: "29577",
    IsoCountry: "US",
    FriendlyName: "Bright Shine Cleaning LLC",
  });
});

Deno.test("REQ-920a the campaign fields: use case, samples, keywords, opt-in, the platform's privacy + terms URLs", () => {
  const c = campaignFields(parseA2pForm(VALID_A2P_FORM), "BNbrand");
  assertEquals(c.BrandRegistrationSid, "BNbrand");
  assertEquals(c.UsAppToPersonUsecase, "CUSTOMER_CARE");
  assertEquals(c.MessageSamples, VALID_A2P_FORM.samples);
  assertEquals(c.OptOutKeywords, ["STOP"]);
  assertEquals(c.HelpKeywords, ["HELP"]);
  assertEquals(c.OptInKeywords, ["START"]);
  assertEquals([c.HasEmbeddedLinks, c.HasEmbeddedPhone], ["false", "true"]);
  assertEquals([c.SubscriberOptIn, c.AgeGated, c.DirectLending], [
    "true",
    "false",
    "false",
  ]);
  assertEquals(c.PrivacyPolicyUrl, "https://documonster.com/privacy");
  assertEquals(c.TermsAndConditionsUrl, "https://documonster.com/sms-terms");
});

Deno.test("REQ-920a evaluationErrors: a noncompliant evaluation names its failing fields", () => {
  assertEquals(
    evaluationErrors("profile", [
      { passed: true, friendly_name: "Address" },
      {
        passed: false,
        friendly_name: "Business Information",
        failure_reason: "Website URL is not reachable",
        invalid: [{
          object_field: "website_url",
          friendly_name: "Website URL",
          failure_reason: "Website URL is not reachable",
          error_code: 22217,
        }],
      },
      {
        passed: false,
        friendly_name: "Authorized Representative",
        failure_reason: "Missing representative",
      },
    ]),
    [
      {
        step: "profile",
        field: "website_url",
        message: "Website URL: Website URL is not reachable",
        code: 22217,
      },
      {
        step: "profile",
        message: "Authorized Representative: Missing representative",
      },
    ],
  );
});

Deno.test("REQ-920a reduceA2pState: profile → brand → campaign, failures, and the ISV prerequisite", () => {
  assertEquals(reduceA2pState({}), "none");
  assertEquals(reduceA2pState({ needsIsvPrimary: true }), "needs_isv_primary");
  assertEquals(
    reduceA2pState({ profileSid: "BU1", needsIsvPrimary: true }),
    "needs_isv_primary",
  );
  assertEquals(
    reduceA2pState({ profileSid: "BU1", profileStatus: "draft" }),
    "profile_pending",
  );
  assertEquals(
    reduceA2pState({ profileSid: "BU1", profileStatus: "pending-review" }),
    "profile_pending",
  );
  assertEquals(
    reduceA2pState({ profileSid: "BU1", profileStatus: "twilio-rejected" }),
    "profile_failed",
  );
  assertEquals(
    reduceA2pState({
      profileSid: "BU1",
      trustProductStatus: "twilio-rejected",
    }),
    "profile_failed",
  );
  assertEquals(
    reduceA2pState({
      profileSid: "BU1",
      brandSid: "BN1",
      brandStatus: "PENDING",
    }),
    "brand_pending",
  );
  assertEquals(
    reduceA2pState({
      profileSid: "BU1",
      brandSid: "BN1",
      brandStatus: "IN_REVIEW",
    }),
    "brand_pending",
  );
  assertEquals(
    reduceA2pState({
      profileSid: "BU1",
      brandSid: "BN1",
      brandStatus: "FAILED",
    }),
    "brand_failed",
  );
  assertEquals(
    reduceA2pState({
      profileSid: "BU1",
      brandSid: "BN1",
      brandStatus: "SUSPENDED",
    }),
    "brand_failed",
  );
  assertEquals(
    reduceA2pState({
      profileSid: "BU1",
      brandSid: "BN1",
      brandStatus: "APPROVED",
    }),
    "campaign_pending",
  );
  assertEquals(
    reduceA2pState({
      profileSid: "BU1",
      brandSid: "BN1",
      brandStatus: "APPROVED",
      campaignSid: "QE1",
      campaignStatus: "IN_PROGRESS",
    }),
    "campaign_pending",
  );
  assertEquals(
    reduceA2pState({
      profileSid: "BU1",
      brandSid: "BN1",
      brandStatus: "APPROVED",
      campaignSid: "QE1",
      campaignStatus: "FAILED",
    }),
    "campaign_failed",
  );
  assertEquals(
    reduceA2pState({
      profileSid: "BU1",
      brandSid: "BN1",
      brandStatus: "APPROVED",
      campaignSid: "QE1",
      campaignStatus: "VERIFIED",
    }),
    "registered",
  );
});

Deno.test("REQ-920a the gate: a subaccount line texts only with a VERIFIED campaign", () => {
  assertEquals(maySendFromSubaccount(null), false);
  assertEquals(maySendFromSubaccount({ campaignStatus: "PENDING" }), false);
  assertEquals(maySendFromSubaccount({ campaignStatus: "FAILED" }), false);
  assertEquals(maySendFromSubaccount({ campaignStatus: "VERIFIED" }), true);
});

Deno.test("REQ-920d a2pSummary: the Systems card's four words", () => {
  assertEquals(a2pSummary(null), "none");
  assertEquals(a2pSummary({ state: "none" }), "none");
  assertEquals(a2pSummary({ state: "needs_isv_primary" }), "none");
  assertEquals(a2pSummary({ state: "profile_pending" }), "pending");
  assertEquals(a2pSummary({ state: "brand_pending" }), "pending");
  assertEquals(a2pSummary({ state: "campaign_pending" }), "pending");
  assertEquals(a2pSummary({ state: "profile_failed" }), "failed");
  assertEquals(a2pSummary({ state: "brand_failed" }), "failed");
  assertEquals(a2pSummary({ state: "campaign_failed" }), "failed");
  assertEquals(a2pSummary({ state: "registered" }), "registered");
});
