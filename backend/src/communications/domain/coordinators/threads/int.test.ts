/** REQ-899 — the inbox: threads newest first with unread counts; opening one shows texts and calls and marks it read. */
import "#reflect-metadata";
import { assertEquals, assertRejects } from "#std/assert";
import { NotFoundError } from "@core/data/repository/mod.ts";
import {
  asTwilio,
  CapturingTwilio,
  freshLine,
  LINE,
  PEER,
  stores,
} from "../_test-support/mod.ts";
import { SendText } from "../send-text/mod.ts";
import { ReceiveText } from "../receive-text/mod.ts";
import { Threads } from "./mod.ts";

Deno.test("REQ-899 threads int: list is newest-activity first with unread counts; get returns texts + calls and clears unread", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const s = await stores();
    const send = new SendText(
      asTwilio(new CapturingTwilio()),
      s.threads,
      s.texts,
      cfg,
    );
    const recv = new ReceiveText(s.threads, s.texts);
    await send.send({ to: "+15125550001", body: "older" });
    await recv.receive({
      MessageSid: "SMa",
      From: PEER,
      To: LINE,
      Body: "newer",
    });
    await s.calls.create({
      line: LINE,
      peer: PEER,
      direction: "inbound",
      providerSid: "CA1",
      status: "completed",
      handledBy: "voicemail",
    });
    const threads = new Threads(s.threads, s.texts, s.calls, cfg);
    const list = await threads.list();
    assertEquals(list.map((t) => t.peer), [PEER, "+15125550001"]);
    assertEquals(list[0].unreadCount, 1);
    const detail = await threads.get("512-555-1234");
    assertEquals(detail.thread.peer, PEER);
    assertEquals(detail.texts.map((t) => t.body), ["newer"]);
    assertEquals(detail.calls.map((c) => c.providerSid), ["CA1"]);
    assertEquals(detail.thread.unreadCount, 0);
    assertEquals((await threads.list())[0].unreadCount, 0);
    await assertRejects(() => threads.get("+15125559999"), NotFoundError);
  } finally {
    await restore();
  }
});
