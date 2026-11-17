/** REQ-899 — sending a text records it on the peer's thread and dispatches it through the line. */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import {
  asTwilio,
  CapturingTwilio,
  freshLine,
  LINE,
  PEER,
  stores,
} from "../_test-support/mod.ts";
import { SendText } from "./mod.ts";

Deno.test("REQ-899 send-text int: dispatches with the status callback, records queued, bumps the thread (not unread)", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const twilio = new CapturingTwilio();
    const s = await stores();
    const out = await new SendText(asTwilio(twilio), s.threads, s.texts, cfg)
      .send({ to: "(512) 555-1234", body: "On my way" });
    assertEquals(out.ok, true);
    assertEquals(out.message.direction, "outbound");
    assertEquals(out.message.peer, PEER);
    assertEquals(out.message.line, LINE);
    assertEquals(out.message.status, "queued");
    assertEquals(out.message.providerSid, "SM1");
    assertEquals(twilio.sent, [{
      to: PEER,
      body: "On my way",
      from: LINE,
      accountSid: "ACtest",
      statusCallback: "https://api.test/communications/twilio/sms-status",
    }]);
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
    twilio.next = {
      ok: false,
      reason: "Invalid 'To' Phone Number",
      code: 21211,
    };
    const s = await stores();
    const out = await new SendText(asTwilio(twilio), s.threads, s.texts, cfg)
      .send({ to: PEER, body: "x" });
    assertEquals(out.ok, false);
    assertEquals(out.reason, "Invalid 'To' Phone Number");
    assertEquals(out.message.status, "failed");
    assertEquals(out.message.errorCode, 21211);
  } finally {
    await restore();
  }
});

Deno.test("REQ-899 send-text int: dev mode (no account SID) records the text as dev and sends nothing", async () => {
  const { restore, cfg } = await freshLine({
    COMMS_TWILIO_ACCOUNT_SID: undefined,
  });
  try {
    const { TwilioClient } = await import(
      "@communications/domain/data/twilio-client/mod.ts"
    );
    const s = await stores();
    const out = await new SendText(
      new TwilioClient(cfg),
      s.threads,
      s.texts,
      cfg,
    ).send({ to: PEER, body: "dev hello" });
    assertEquals(out.ok, true);
    assertEquals(out.message.status, "dev");
    assertEquals(out.message.providerSid, undefined);
  } finally {
    await restore();
  }
});
