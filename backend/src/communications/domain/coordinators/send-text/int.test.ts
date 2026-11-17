/** REQ-899 — sending a text records it on the peer's thread and dispatches it through the line. */
import "#reflect-metadata";
import { assertEquals, assertRejects } from "#std/assert";
import { asTwilio, CapturingTwilio, freshLine, LINE, PEER, stores } from "../_test-support/mod.ts";
import { SendText } from "./mod.ts";

Deno.test("REQ-899 send-text int: dispatches with the status callback, records queued, bumps the thread (not unread)", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const twilio = new CapturingTwilio();
    const s = await stores();
    const out = await new SendText(asTwilio(twilio), s.threads, s.texts, cfg).send({ to: "(512) 555-1234", body: "On my way" });
    assertEquals(out.ok, true);
    assertEquals(out.message.direction, "outbound");
    assertEquals(out.message.peer, PEER);
    assertEquals(out.message.line, LINE);
    assertEquals(out.message.status, "queued");
    assertEquals(out.message.providerSid, "SM1");
    assertEquals(twilio.sent, [{ to: PEER, body: "On my way", from: LINE, accountSid: "ACtest", statusCallback: "https://api.test/communications/twilio/sms-status" }]);
    const thread = await s.threads.findByPeer(LINE, PEER);
    assertEquals(thread?.lastPreview, "On my way");
    assertEquals(thread?.unreadCount, 0);
    assertEquals((await s.texts.listByThread(thread!.id)).length, 1);
  } finally {
    await restore();
  }
});

Deno.test("REQ-899 send-text int: a Twilio rejection is recorded as failed with the code, and reported", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const twilio = new CapturingTwilio();
    twilio.next = { ok: false, reason: "Invalid 'To' Phone Number", code: 21211 };
    const s = await stores();
    const out = await new SendText(asTwilio(twilio), s.threads, s.texts, cfg).send({ to: PEER, body: "x" });
    assertEquals(out.ok, false);
    assertEquals(out.reason, "Invalid 'To' Phone Number");
    assertEquals(out.message.status, "failed");
    assertEquals(out.message.errorCode, 21211);
  } finally {
    await restore();
  }
});

Deno.test("REQ-899 send-text int: dev mode (no account SID) records the text as dev and sends nothing", async () => {
  const { restore, cfg } = await freshLine({ COMMS_TWILIO_ACCOUNT_SID: undefined });
  try {
    const { TwilioClient } = await import("@communications/domain/data/twilio-client/mod.ts");
    const s = await stores();
    const out = await new SendText(new TwilioClient(cfg), s.threads, s.texts, cfg).send({ to: PEER, body: "dev hello" });
    assertEquals(out.ok, true);
    assertEquals(out.message.status, "dev");
    assertEquals(out.message.providerSid, undefined);
  } finally {
    await restore();
  }
});

// ── REQ-920a — texting from a subaccount line waits for a VERIFIED campaign ──

async function subLineAndRegistration(campaignStatus?: string) {
  const { A2pStore } = await import("@communications/domain/data/a2p-store/mod.ts");
  const { resolvedFromLine } = await import("@communications/domain/business/line-resolution/mod.ts");
  const s = await stores();
  const line = await s.lines.create({ userId: "u_sub", subaccountSid: "ACsubGate", number: "+18435550999", numberSid: "PNgate", apiKeySid: "SKgate", twimlAppSid: "APgate", authToken: "t", apiKeySecret: "k" });
  const a2p = new A2pStore();
  if (campaignStatus) {
    const now = new Date().toISOString();
    await a2p.save({ lineId: line.id, userId: "u_sub", subaccountSid: "ACsubGate", form: {} as never, assigned: [], campaignSid: "QEgate", campaignStatus, state: campaignStatus === "VERIFIED" ? "registered" : "campaign_pending", errors: [], createdAt: now, updatedAt: now });
  }
  return { s, a2p, on: resolvedFromLine(line, { authToken: "t", apiKeySecret: "k" }) };
}

Deno.test("REQ-920a send-text int: a subaccount line without a VERIFIED campaign is refused (403 a2p_unregistered), nothing sent or recorded", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const { A2pUnregisteredError } = await import("./mod.ts");
    for (const status of [undefined, "PENDING", "FAILED"]) {
      const twilio = new CapturingTwilio();
      const { s, a2p, on } = await subLineAndRegistration(status);
      const e = await assertRejects(() => new SendText(asTwilio(twilio), s.threads, s.texts, cfg, a2p).send({ to: PEER, body: "hi" }, on), A2pUnregisteredError);
      assertEquals([e.status, e.code], [403, "a2p_unregistered"]);
      assertEquals(twilio.sent.length, 0);
      assertEquals(await s.threads.findByPeer("+18435550999", PEER), null);
      await (await import("@core/data/kv/mod.ts")).resetKv();
    }
  } finally {
    await restore();
  }
});

Deno.test("REQ-920a send-text int: a VERIFIED campaign lets the subaccount line text; COMMS_A2P_GATE=off lets it without one", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const twilio = new CapturingTwilio();
    const { s, a2p, on } = await subLineAndRegistration("VERIFIED");
    const out = await new SendText(asTwilio(twilio), s.threads, s.texts, cfg, a2p).send({ to: PEER, body: "registered" }, on);
    assertEquals(out.ok, true);
    assertEquals(twilio.sent[0].accountSid, "ACsubGate");
  } finally {
    await restore();
  }
  const off = await freshLine({ COMMS_A2P_GATE: "off" });
  try {
    const twilio = new CapturingTwilio();
    const { s, a2p, on } = await subLineAndRegistration();
    const out = await new SendText(asTwilio(twilio), s.threads, s.texts, off.cfg, a2p).send({ to: PEER, body: "dev" }, on);
    assertEquals(out.ok, true);
    assertEquals(twilio.sent.length, 1);
  } finally {
    await off.restore();
  }
});
