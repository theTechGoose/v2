/** REQ-904 — one line per request: the user's for the app, the subaccount's for Twilio. */
import "#reflect-metadata";
import { assertEquals, assertRejects } from "#std/assert";
import { freshLine, LINE, stores, TEST_AUTH_TOKEN } from "../_test-support/mod.ts";
import { ProvisioningTwilio } from "../_test-support/provisioning.ts";
import { Lines } from "../lines/mod.ts";
import { LineContext, NoLineError, UnknownLineError } from "./mod.ts";

Deno.test("REQ-904 line-context int: the env line belongs to COMMS_ENV_LINE_OWNER only; a bought line belongs to its user, with unsealed credentials", async () => {
  const { restore, cfg } = await freshLine({ COMMS_ENV_LINE_OWNER: "owner_1" });
  try {
    const s = await stores();
    const lines = new Lines(new ProvisioningTwilio().asClient(), s.lines, cfg);
    const ctx = new LineContext(s.lines, cfg);
    const env = await ctx.forUser("owner_1");
    assertEquals(env.kind, "env");
    assertEquals(env.number, LINE);
    assertEquals(env.accountSid, "ACtest");
    assertEquals(env.authToken, TEST_AUTH_TOKEN);
    assertEquals(env.apiKeySid, "SKtest");
    assertEquals(env.ringIdentities, ["u_1", "u_2"]);

    await assertRejects(() => ctx.forUser("someone_else"), NoLineError);
    assertEquals(new NoLineError().status, 409);

    await lines.buy("cust_1", { phoneNumber: "+18435550100" });
    const bought = await ctx.forUser("cust_1");
    assertEquals(bought.kind, "subaccount");
    assertEquals(bought.number, "+18435550100");
    assertEquals(bought.accountSid, "ACsub1");
    assertEquals(bought.authToken, "sub1-token");
    assertEquals(bought.apiKeySid, "SKsub1");
    assertEquals(bought.apiKeySecret, "sub1-secret");
    assertEquals(bought.twimlAppSid, "APsub1");
    assertEquals(bought.ringIdentities, ["cust_1"]);
    assertEquals(bought.userId, "cust_1");

    await lines.release("cust_1");
    await assertRejects(() => ctx.forUser("cust_1"), NoLineError);
  } finally {
    await restore();
  }
});

Deno.test("REQ-904 line-context int: a webhook resolves by AccountSid — main → env line, a subaccount → its line, anything else → forbidden", async () => {
  const { restore, cfg } = await freshLine({ COMMS_ENV_LINE_OWNER: "owner_1" });
  try {
    const s = await stores();
    await new Lines(new ProvisioningTwilio().asClient(), s.lines, cfg).buy("cust_1", { phoneNumber: "+18435550100" });
    const ctx = new LineContext(s.lines, cfg);
    assertEquals((await ctx.forWebhook({ AccountSid: "ACtest" })).kind, "env");
    const sub = await ctx.forWebhook({ AccountSid: "ACsub1" });
    assertEquals(sub.kind, "subaccount");
    assertEquals(sub.authToken, "sub1-token");
    await assertRejects(() => ctx.forWebhook({ AccountSid: "ACnobody" }), UnknownLineError);
    await assertRejects(() => ctx.forWebhook({}), UnknownLineError);
    assertEquals(new UnknownLineError().status, 403);
  } finally {
    await restore();
  }
});

Deno.test("REQ-904 line-context int: without COMMS_ENV_LINE_OWNER nobody gets the env line, and the main account's webhooks are still verifiable", async () => {
  const { restore, cfg } = await freshLine({ COMMS_ENV_LINE_OWNER: undefined });
  try {
    const s = await stores();
    const ctx = new LineContext(s.lines, cfg);
    await assertRejects(() => ctx.forUser("anyone"), NoLineError);
    assertEquals((await ctx.forWebhook({ AccountSid: "ACtest" })).kind, "env");
  } finally {
    await restore();
  }
});
