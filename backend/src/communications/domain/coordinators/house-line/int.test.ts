/** REQ-920b — the platform's own line texts under the platform's registration: the number moves to the main account and joins a verified campaign's messaging service */
import "#reflect-metadata";
import { assertEquals, assertRejects } from "#std/assert";
import { freshLine, stores } from "../_test-support/mod.ts";
import { ProvisioningTwilio } from "../_test-support/provisioning.ts";
import { Lines } from "../lines/mod.ts";
import { LineContext, NoLineError } from "../line-context/mod.ts";
import { HouseLine, HouseLineError } from "./mod.ts";

Deno.test("REQ-920b services(): only the main account's messaging services whose campaign is VERIFIED", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const s = await stores();
    const twilio = new ProvisioningTwilio();
    const house = new HouseLine(twilio.asClient(), s.lines, cfg);
    assertEquals(await house.services(), [{
      sid: "MGsupport",
      friendlyName: "Monster Support",
      usecase: "CUSTOMER_CARE",
    }]);
  } finally {
    await restore();
  }
});

Deno.test("REQ-920b adopt(): transfer → main-account key + app → webhooks → service → the empty subaccount closed; the line is now kind main and every resolution follows", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const s = await stores();
    const twilio = new ProvisioningTwilio();
    const lines = new Lines(twilio.asClient(), s.lines, cfg);
    const house = new HouseLine(twilio.asClient(), s.lines, cfg);
    const ctx = new LineContext(s.lines, cfg);
    await assertRejects(() => house.adopt("u_1", "MGsupport"), NoLineError);
    const bought = await lines.buy("u_1", { phoneNumber: "+18435550100" });
    const subSid = bought.subaccountSid;
    twilio.calls.length = 0;

    const bad = await assertRejects(
      () => house.adopt("u_1", "MGmarketing"),
      HouseLineError,
    );
    assertEquals([bad.status, bad.code], [400, "service_not_verified"]);

    const adopted = await house.adopt("u_1", "MGsupport");
    assertEquals(
      twilio.calls.filter((c) =>
        c.op !== "listMessagingServices" && c.op !== "listCampaigns"
      ).map((c) => c.op),
      [
        "transferNumber",
        "createApiKey",
        "createTwimlApp",
        "updateNumber",
        "addNumberToService",
        "closeSubaccount",
      ],
    );
    const transfer = twilio.calls.find((c) => c.op === "transferNumber")!.args;
    assertEquals(transfer, {
      numberSid: bought.numberSid,
      toAccountSid: cfg.get().accountSid,
    });
    assertEquals(
      twilio.calls.find((c) => c.op === "createApiKey")!.args.accountSid,
      cfg.get().accountSid,
    );
    assertEquals(
      twilio.calls.find((c) => c.op === "addNumberToService")!.args,
      { serviceSid: "MGsupport", numberSid: bought.numberSid },
    );
    assertEquals(twilio.calls.find((c) => c.op === "closeSubaccount")!.args, {
      accountSid: subSid,
    });
    assertEquals([
      adopted.kind,
      adopted.messagingServiceSid,
      adopted.campaignUsecase,
      adopted.number,
    ], ["main", "MGsupport", "CUSTOMER_CARE", "+18435550100"]);
    assertEquals(adopted.subaccountSid, "");

    // resolution: the app's line is the main account with the NEW key; a webhook to the number finds it; another number is still the env line
    const r = await ctx.forUser("u_1");
    assertEquals([
      r.kind,
      r.accountSid,
      r.authToken,
      r.apiKeySid,
      r.twimlAppSid,
    ], [
      "main",
      cfg.get().accountSid,
      cfg.get().authToken,
      adopted.apiKeySid,
      adopted.twimlAppSid,
    ]);
    const w = await ctx.forWebhook({
      AccountSid: cfg.get().accountSid,
      To: "+18435550100",
    });
    assertEquals([w.kind, w.userId], ["main", "u_1"]);
    const env = await ctx.forWebhook({
      AccountSid: cfg.get().accountSid,
      To: cfg.get().from,
    });
    assertEquals(env.kind, "env");
    assertEquals(
      await s.lines.findBySubaccount(subSid),
      null,
      "the subaccount index is gone",
    );

    // twice is a no-op complaint, not a second transfer
    const again = await assertRejects(
      () => house.adopt("u_1", "MGsupport"),
      HouseLineError,
    );
    assertEquals(again.code, "already_house");

    // releasing a main line gives the number back on the main account and closes nothing
    twilio.calls.length = 0;
    const released = await lines.release("u_1");
    assertEquals(released?.status, "released");
    assertEquals(twilio.calls.map((c) => c.op), ["releaseNumber"]);
    assertEquals(twilio.calls[0].args, {
      accountSid: cfg.get().accountSid,
      numberSid: bought.numberSid,
    });
  } finally {
    await restore();
  }
});

Deno.test("REQ-920b adopt(): a failed transfer changes nothing", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const s = await stores();
    const twilio = new ProvisioningTwilio();
    const lines = new Lines(twilio.asClient(), s.lines, cfg);
    await lines.buy("u_2", { phoneNumber: "+18435550101" });
    twilio.failTransferWith = {
      ok: false,
      reason: "Number cannot be transferred",
      code: 21456,
    };
    const house = new HouseLine(twilio.asClient(), s.lines, cfg);
    const err = await assertRejects(() => house.adopt("u_2", "MGsupport"));
    assertEquals((err as { status?: number }).status, 502);
    const line = await s.lines.findActiveByUser("u_2");
    assertEquals(line?.kind, "subaccount");
  } finally {
    await restore();
  }
});
