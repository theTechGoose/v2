/** REQ-903/905 — provisioning a customer's line on its own subaccount, and giving it back. */
import "#reflect-metadata";
import { assertEquals, assertRejects, assertStringIncludes } from "#std/assert";
import { getKv } from "@core/data/kv/mod.ts";
import { openSecret, secretsKey } from "@core/business/secret-box/mod.ts";
import { freshLine, stores } from "../_test-support/mod.ts";
import { ProvisioningTwilio } from "../_test-support/provisioning.ts";
import { LineConflictError, Lines, ProvisioningError } from "./mod.ts";

Deno.test("REQ-903 lines int: buy = subaccount → api key → twiml app → number, all URLs on our public origin; secrets sealed in KV, absent from the result", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const twilio = new ProvisioningTwilio();
    const s = await stores();
    const lines = new Lines(twilio.asClient(), s.lines, cfg);
    const line = await lines.buy("u_1", {
      phoneNumber: "+18435550100",
      friendlyName: "Shop",
    });
    assertEquals(twilio.calls.map((c) => c.op), [
      "createSubaccount",
      "createApiKey",
      "createTwimlApp",
      "buyNumber",
    ]);
    assertEquals(twilio.calls[0].args, { friendlyName: "documonster:u_1" });
    assertEquals(twilio.calls[1].args, {
      accountSid: "ACsub1",
      friendlyName: "documonster:u_1 softphone",
    });
    assertEquals(twilio.calls[2].args, {
      accountSid: "ACsub1",
      friendlyName: "documonster:u_1 softphone",
      voiceUrl: "https://api.test/communications/twilio/voice/outgoing",
    });
    assertEquals(twilio.calls[3].args, {
      accountSid: "ACsub1",
      phoneNumber: "+18435550100",
      friendlyName: "Shop",
      voiceUrl: "https://api.test/communications/twilio/voice/incoming",
      smsUrl: "https://api.test/communications/twilio/sms",
      statusCallback: "https://api.test/communications/twilio/voice/status",
    });
    assertEquals(line.status, "active");
    assertEquals(line.number, "+18435550100");
    assertEquals(line.subaccountSid, "ACsub1");
    assertEquals(line.apiKeySid, "SKsub1");
    assertEquals(line.twimlAppSid, "APsub1");
    assertEquals("authTokenSealed" in line, false);
    const kv = await getKv();
    const raw = (await kv.get<Record<string, string>>(["comms_line", line.id]))
      .value!;
    assertStringIncludes(raw.authTokenSealed, "v1.");
    assertEquals(raw.authTokenSealed.includes("sub1-token"), false);
    const key = await secretsKey();
    assertEquals(await openSecret(raw.authTokenSealed, key), "sub1-token");
    assertEquals(await openSecret(raw.apiKeySecretSealed, key), "sub1-secret");
    assertEquals((await lines.get("u_1"))?.id, line.id);
    assertEquals(await lines.get("u_2"), null);
  } finally {
    await restore();
  }
});

Deno.test("REQ-903 lines int: a second buy on an active line is a 409; a failed number purchase closes the subaccount it made", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const twilio = new ProvisioningTwilio();
    const s = await stores();
    const lines = new Lines(twilio.asClient(), s.lines, cfg);
    await lines.buy("u_1", { phoneNumber: "+18435550100" });
    await assertRejects(
      () => lines.buy("u_1", { phoneNumber: "+18435550101" }),
      LineConflictError,
    );
    assertEquals(new LineConflictError().status, 409);

    const failing = new ProvisioningTwilio();
    failing.failBuyWith = {
      ok: false,
      reason: "The requested phone number is not available",
      code: 21422,
    };
    const lines2 = new Lines(failing.asClient(), s.lines, cfg);
    const err = await assertRejects(
      () => lines2.buy("u_9", { phoneNumber: "+18435550199" }),
      ProvisioningError,
    );
    assertEquals(err.status, 502);
    assertStringIncludes(err.message, "not available");
    assertEquals(failing.calls.at(-1)?.op, "closeSubaccount");
    assertEquals(await lines2.get("u_9"), null);

    // REQ-917: no keys on the server → the error names it, so the page can say so
    const unconfigured = new ProvisioningTwilio();
    unconfigured.failSearchWith = { ok: false, reason: "not_configured" };
    const lines3 = new Lines(unconfigured.asClient(), s.lines, cfg);
    const nc = await assertRejects(
      () => lines3.search({ areaCode: "843" }),
      ProvisioningError,
    );
    assertEquals(nc.status, 502);
    assertEquals(nc.reason, "not_configured");
    assertEquals(
      JSON.parse(JSON.stringify({ ...nc })).reason,
      "not_configured",
    );
  } finally {
    await restore();
  }
});

Deno.test("REQ-905 lines int: release gives the number back, closes the subaccount, flips the line; a second release is a no-op", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const twilio = new ProvisioningTwilio();
    const s = await stores();
    const lines = new Lines(twilio.asClient(), s.lines, cfg);
    const line = await lines.buy("u_1", { phoneNumber: "+18435550100" });
    twilio.calls.length = 0;
    const released = await lines.release("u_1");
    assertEquals(twilio.calls.map((c) => c.op), [
      "releaseNumber",
      "closeSubaccount",
    ]);
    assertEquals(twilio.calls[0].args, {
      accountSid: "ACsub1",
      numberSid: "PNsub1",
    });
    assertEquals(released?.status, "released");
    assertEquals(typeof released?.releasedAt, "string");
    assertEquals(released?.id, line.id);
    twilio.calls.length = 0;
    const again = await lines.release("u_1");
    assertEquals(again?.status, "released");
    assertEquals(twilio.calls, []);
    // a released line is not an active one: the user may buy again
    const fresh = await lines.buy("u_1", { phoneNumber: "+18435550102" });
    assertEquals(fresh.status, "active");
    assertEquals(fresh.id === line.id, false);
    assertEquals((await lines.get("u_1"))?.id, fresh.id);
  } finally {
    await restore();
  }
});

Deno.test("REQ-918b no public URL (a laptop): the number and its TwiML App are created without webhook URLs", async () => {
  const { restore, cfg } = await freshLine({
    COMMS_PUBLIC_URL: "",
    PUBLIC_BACKEND_URL: undefined,
  });
  try {
    const s = await stores();
    const twilio = new ProvisioningTwilio();
    const lines = new Lines(twilio.asClient(), s.lines, cfg);
    await lines.buy("u_laptop", { phoneNumber: "+18435550100" });
    const app = twilio.calls.find((c) => c.op === "createTwimlApp")!.args as {
      voiceUrl: string;
    };
    const num = twilio.calls.find((c) => c.op === "buyNumber")!.args as {
      voiceUrl: string;
      smsUrl: string;
      statusCallback: string;
    };
    assertEquals(app.voiceUrl, "");
    assertEquals([num.voiceUrl, num.smsUrl, num.statusCallback], ["", "", ""]);
  } finally {
    await restore();
  }
});
