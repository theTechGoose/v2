/** REQ-899 — delivery state flows back onto the sent text. */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import {
  asTwilio,
  CapturingTwilio,
  freshLine,
  PEER,
  stores,
} from "../_test-support/mod.ts";
import { SendText } from "../send-text/mod.ts";
import { TextStatus } from "./mod.ts";

Deno.test("REQ-899 text-status int: queued → sent → delivered; undelivered carries the error code; unknown SIDs are ignored", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const s = await stores();
    const sent = await new SendText(
      asTwilio(new CapturingTwilio()),
      s.threads,
      s.texts,
      cfg,
    ).send({ to: PEER, body: "x" });
    const st = new TextStatus(s.texts);
    assertEquals(
      (await st.apply({ MessageSid: "SM1", MessageStatus: "sent" }))?.status,
      "sent",
    );
    assertEquals(
      (await st.apply({ MessageSid: "SM1", MessageStatus: "delivered" }))
        ?.status,
      "delivered",
    );
    const failed = await st.apply({
      MessageSid: "SM1",
      MessageStatus: "undelivered",
      ErrorCode: "30003",
    });
    assertEquals(failed?.status, "undelivered");
    assertEquals(failed?.errorCode, 30003);
    assertEquals(failed?.id, sent.message.id);
    assertEquals(
      await st.apply({ MessageSid: "SMnope", MessageStatus: "delivered" }),
      null,
    );
  } finally {
    await restore();
  }
});
