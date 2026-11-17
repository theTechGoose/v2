/**
 * REQ-920a/c/d — the Texting registration panel in the browser, against the
 * real communications API with Twilio (provisioning, TrustHub, Messaging)
 * stood in by one local server: an owner with a bought line sees "Not
 * registered" and the fee note; a text is refused in one line; they fill the
 * form and submit; the platform's profile is not ISV-type yet, so the panel
 * says so in one line; once it is, "Check status" walks on and shows "In
 * review"; the stand-in approves the brand and verifies the campaign, "Check
 * status" shows "Registered", the text goes out, and Settings → Systems says
 * Registered on the Phone & text card.
 *
 * The served app reads COMMS_* from the env `shots run` passes it, so run it as
 *
 *   COMMS_TWILIO_ACCOUNT_SID=ACphoneE2E COMMS_TWILIO_AUTH_TOKEN=phone-e2e-token \
 *   COMMS_TWILIO_BASE_URL=http://127.0.0.1:9148 COMMS_PUBLIC_URL=https://phone-e2e.test/api \
 *   COMMS_TRUSTHUB_BASE_URL=http://127.0.0.1:9148 COMMS_MESSAGING_BASE_URL=http://127.0.0.1:9148 \
 *   deno task test:e2e e2e/communications/a2p.e2e.test.ts
 *
 * Without those the story records itself skipped with that reason.
 */
import { story, type StoryTools } from "#shots";
import { A2pStandIn } from "../../backend/src/communications/domain/coordinators/_test-support/a2p-stand-in.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const NUMBER = "+18435550188";
const PEER = "+15125559877";

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
  });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: body.recoveryToken }),
    });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      language: "en",
      name: "A2P Story",
      email: "a2p-story@example.com",
    }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  await page.context().addCookies([{ name, value, url: baseUrl }]);
  return { auth };
}

/** Twilio's subaccount provisioning + Messages, for one subaccount SID (unique per run) */
function provisioning(
  sub: string,
  method: string,
  path: string,
  form: URLSearchParams,
): { status: number; body: unknown } {
  const json = (body: unknown, status = 201) => ({ status, body });
  if (path === "/2010-04-01/Accounts.json") {
    return json({ sid: sub, auth_token: "sub-a2p-token", status: "active" });
  }
  if (path === `/2010-04-01/Accounts/${sub}/Keys.json`) {
    return json({ sid: "SKsubA2p", secret: "sub-a2p-key-secret" });
  }
  if (path === `/2010-04-01/Accounts/${sub}/Applications.json`) {
    return json({ sid: "APsubA2p" });
  }
  if (path === `/2010-04-01/Accounts/${sub}/IncomingPhoneNumbers.json`) {
    return json({ sid: "PNsubA2p", phone_number: form.get("PhoneNumber") });
  }
  if (
    method === "DELETE" &&
    path === `/2010-04-01/Accounts/${sub}/IncomingPhoneNumbers/PNsubA2p.json`
  ) return { status: 204, body: null };
  if (path === `/2010-04-01/Accounts/${sub}.json`) {
    return json({ sid: sub, status: form.get("Status") }, 200);
  }
  if (path.endsWith("/Messages.json")) {
    return json({ sid: "SMsubA2p", status: "queued" });
  }
  return json({
    code: 20404,
    message: `stand-in: no route for ${method} ${path}`,
  }, 404);
}

Deno.test("REQ-920a/c/d: a bought line → Not registered + fee note → a text refused → the form → the ISV prerequisite line → In review → Registered → the text goes out; Systems says Registered", (t) =>
  story(t, async ({ page, expect, http, baseUrl, skip }) => {
    const twilioBase = Deno.env.get("COMMS_TWILIO_BASE_URL");
    const trusthub = Deno.env.get("COMMS_TRUSTHUB_BASE_URL");
    const messaging = Deno.env.get("COMMS_MESSAGING_BASE_URL");
    if (
      !twilioBase || !trusthub || !messaging ||
      !Deno.env.get("COMMS_TWILIO_ACCOUNT_SID") ||
      !Deno.env.get("COMMS_PUBLIC_URL")
    ) {
      skip(
        "needs COMMS_TWILIO_BASE_URL, COMMS_TRUSTHUB_BASE_URL and COMMS_MESSAGING_BASE_URL (one local port), COMMS_TWILIO_ACCOUNT_SID, COMMS_TWILIO_AUTH_TOKEN and COMMS_PUBLIC_URL in the env of `deno task test:e2e` — the served app reads them",
      );
    }

    const sub = `ACsubA2p${digits()}`;
    const stand = new A2pStandIn();
    stand.primaryIsIsv = false;
    const seen: { method: string; path: string; form: URLSearchParams }[] = [];
    const twilio = Deno.serve({
      port: Number(new URL(twilioBase!).port),
      onListen() {},
    }, async (req) => {
      const u = new URL(req.url);
      const form = new URLSearchParams(await req.text());
      seen.push({ method: req.method, path: u.pathname, form });
      const account =
        atob((req.headers.get("authorization") ?? "Basic Og==").slice(6)).split(
          ":",
        )[0];
      const { status, body } =
        stand.handle(req.method, u.pathname + u.search, form, account) ??
          provisioning(sub, req.method, u.pathname, form);
      return body === null
        ? new Response(null, { status })
        : new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
    });

    try {
      const { auth } = await signIn(http, page, baseUrl);
      // the line (the shop's own story is phone.e2e.test.ts)
      const bought = await http("/api/communications/numbers", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ phoneNumber: NUMBER }),
      });
      expect.eq(bought.status, 200, "the number was bought on the stand-in");
      await bought.body?.cancel();
      await page.route("https://esm.sh/**", (r) => r.abort()); // the softphone SDK is not this story's

      // 1. the panel under the line card: Not registered, the form, the fee note before submit
      await page.goto("/communications");
      await page.locator("[data-cy='comms-page'][data-mode='line']").waitFor({
        timeout: 30_000,
      });
      await page.locator("[data-cy='a2p-panel'][data-loaded='1']").waitFor({
        timeout: 30_000,
      });
      expect.eq(
        (await page.locator("[data-cy='a2p-state']").textContent())?.trim(),
        "Not registered",
        "the panel starts at Not registered",
      );
      await page.locator("[data-cy='a2p-form']").waitFor();
      await expect.see(
        "Twilio bills the brand and campaign registration fees to DocuMonster's account, not to you.",
      );

      // 2. a text before registration: refused, in one line
      await page.locator("[data-cy='comms-new-text']").click();
      await page.locator("[data-cy='comms-new-to']").fill("512-555-9877");
      await page.locator("[data-cy='comms-compose']").fill("Too early");
      await page.locator("[data-cy='comms-send']").click();
      await page.locator("[data-cy='comms-inbox-err']").waitFor();
      expect.eq(
        (await page.locator("[data-cy='comms-inbox-err']").textContent())
          ?.trim(),
        "This number can't text yet: its texting registration has to be approved first (see Texting registration).",
        "the gate's refusal is one line",
      );
      expect(
        !seen.some((c) => c.path.endsWith("/Messages.json")),
        "nothing reached Twilio's Messages",
      );

      // 3. fill the form (the opt-in / opt-out / help wording is suggested from the name)
      const fill = (k: string, v: string) =>
        page.locator(`[data-cy='a2p-${k}']`).fill(v);
      const pick = (k: string, v: string) =>
        page.locator(`[data-cy='a2p-${k}']`).selectOption(v);
      await fill("legalName", "Bright Shine Cleaning LLC");
      await fill("ein", "12-3456789");
      await pick("businessType", "Limited Liability Corporation");
      await pick("industry", "PROFESSIONAL_SERVICES");
      await fill("website", "https://brightshine.example.com");
      await fill("repFirstName", "Dana");
      await fill("repLastName", "Reyes");
      await fill("repEmail", "dana@brightshine.example.com");
      await fill("repPhone", "(843) 555-0142");
      await fill("repTitle", "Owner");
      await pick("repPosition", "CEO");
      await fill("street", "100 Ocean Blvd");
      await fill("city", "Myrtle Beach");
      await fill("region", "SC");
      await fill("postalCode", "29577");
      await fill(
        "description",
        "Appointment confirmations, schedule changes and replies to customers who contacted Bright Shine Cleaning.",
      );
      await fill(
        "messageFlow",
        "Customers give their mobile number on our booking form or by phone and agree to receive texts about their cleaning.",
      );
      await fill(
        "sample-0",
        "Bright Shine Cleaning: your cleaning is confirmed for Tuesday at 9am. Reply STOP to opt out.",
      );
      await fill(
        "sample-1",
        "Bright Shine Cleaning: our crew is on the way and will arrive in about 20 minutes.",
      );
      expect(
        ((await page.locator("[data-cy='a2p-optOutMessage']").inputValue()) ??
          "").startsWith("Bright Shine Cleaning LLC: you're unsubscribed"),
        "the opt-out wording was suggested with the business's name",
      );

      // 4. submit: the platform's profile is not ISV-type yet → the one-line prerequisite; the form stays
      await page.locator("[data-cy='a2p-submit']").click();
      await page.locator("[data-cy='a2p-isv']").waitFor({ timeout: 30_000 });
      expect.eq(
        (await page.locator("[data-cy='a2p-isv']").textContent())?.trim(),
        "Twilio has to mark the platform's business profile as ISV Reseller or Partner before customer lines can be registered.",
        "the ISV prerequisite, in one line",
      );
      expect.eq(
        await page.locator("[data-cy='a2p-panel']").getAttribute("data-state"),
        "needs_isv_primary",
        "the registration waits at the primary profile",
      );
      expect(
        await page.locator("[data-cy='a2p-form']").isVisible(),
        "the form is still usable",
      );
      const writes = seen.filter((c) =>
        c.method === "POST" && !c.path.endsWith("/Messages.json")
      );
      expect.eq(
        writes.slice(-8).map((c) => c.path.replace(/(BU|IT|AD|RD)\w+/g, "$1…"))
          .join(" | "),
        [
          "/v1/CustomerProfiles",
          "/v1/EndUsers",
          "/v1/CustomerProfiles/BU…/EntityAssignments",
          "/v1/EndUsers",
          "/v1/CustomerProfiles/BU…/EntityAssignments",
          `/2010-04-01/Accounts/${sub}/Addresses.json`,
          "/v1/SupportingDocuments",
          "/v1/CustomerProfiles/BU…/EntityAssignments",
        ].join(" | "),
        "everything up to the address was filed on the line's subaccount",
      );

      // 5. Twilio marks the platform ISV: Check status walks on to the brand → In review
      stand.primaryIsIsv = true;
      await page.locator("[data-cy='a2p-check']").click();
      await page.locator("[data-cy='a2p-state'][data-headline='pending']")
        .waitFor({ timeout: 30_000 });
      expect.eq(
        (await page.locator("[data-cy='a2p-state']").textContent())?.trim(),
        "In review",
        "submitted: In review",
      );
      expect.eq(
        await page.locator("[data-cy='a2p-step']").evaluateAll((els) =>
          els.map((e) =>
            `${e.getAttribute("data-step")}:${e.getAttribute("data-status")}`
          ).join(" | ")
        ),
        "profile:pending | brand:pending | campaign:todo",
        "the strip: profile and brand in review, campaign not started",
      );
      expect(
        seen.some((c) => c.path === "/v1/a2p/BrandRegistrations"),
        "the brand was registered",
      );
      expect(
        seen.some((c) =>
          c.path === "/v1/Services" &&
          c.form.get("InboundRequestUrl")?.endsWith(
            "/communications/twilio/sms",
          )
        ),
        "the messaging service points inbound texts at us",
      );
      expect.eq(
        await page.locator("[data-cy='a2p-form']").count(),
        0,
        "once submitted, the form gives way to the status",
      );

      // 6. the brand is approved and the campaign verified: Check status → Registered
      stand.profileStatus = "twilio-approved";
      stand.trustProductStatus = "twilio-approved";
      stand.brandStatus = "APPROVED";
      stand.campaignStatus = "VERIFIED";
      await page.locator("[data-cy='a2p-check']").click();
      await page.locator("[data-cy='a2p-state'][data-headline='registered']")
        .waitFor({ timeout: 30_000 });
      expect.eq(
        (await page.locator("[data-cy='a2p-state']").textContent())?.trim(),
        "Registered",
        "Check status shows Registered",
      );
      expect.eq(
        await page.locator("[data-cy='a2p-step']").evaluateAll((els) =>
          els.map((e) => e.getAttribute("data-status")).join(" ")
        ),
        "ok ok ok",
        "profile, brand and campaign approved",
      );
      const campaign = seen.find((c) => c.path.endsWith("/Compliance/Usa2p"));
      expect.eq(
        campaign?.form.get("UsAppToPersonUsecase"),
        "CUSTOMER_CARE",
        "the campaign was filed with the use case",
      );

      // 7. now the text goes out from the line, on its subaccount
      await page.locator("[data-cy='comms-send']").click();
      await page.locator(`[data-cy='comms-thread'][data-peer='${PEER}']`)
        .waitFor({ timeout: 30_000 });
      const out = seen.filter((c) => c.path.endsWith("/Messages.json")).at(-1);
      expect.eq(
        out?.path,
        `/2010-04-01/Accounts/${sub}/Messages.json`,
        "the text left on the line's subaccount",
      );

      // 8. REQ-920d — Settings → Systems: the Phone & text card says Registered
      await page.goto("/settings?tab=systems");
      const a2p = page.locator("[data-cy='sys-line-a2p']");
      await a2p.waitFor({ timeout: 30_000 });
      expect.eq(
        await a2p.getAttribute("data-a2p"),
        "registered",
        "the card carries the registration",
      );
      expect(
        ((await a2p.textContent()) ?? "").includes("Registered"),
        "the card says Registered",
      );

      await (await http("/api/communications/line/release", {
        method: "POST",
        headers: auth,
        body: "{}",
      })).body?.cancel();
    } finally {
      await twilio.shutdown();
    }
  }));
