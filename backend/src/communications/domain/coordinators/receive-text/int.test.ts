/** REQ-899 — an inbound text lands on the peer's thread, unread, with its media. */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { freshLine, LINE, PEER, stores } from "../_test-support/mod.ts";
import { ReceiveText } from "./mod.ts";

Deno.test("REQ-899 receive-text int: records the inbound text (received, with MMS urls) and bumps the thread's unread count", async () => {
  const { restore } = await freshLine();
  try {
    const s = await stores();
    const r = new ReceiveText(s.threads, s.texts);
    const first = await r.receive({ MessageSid: "SMin1", From: PEER, To: LINE, Body: "Are you open today?", NumMedia: "1", MediaUrl0: "https://api.twilio.com/m/1" });
    assertEquals(first.direction, "inbound");
    assertEquals(first.status, "received");
    assertEquals(first.providerSid, "SMin1");
    assertEquals(first.mediaUrls, ["https://api.twilio.com/m/1"]);
    await r.receive({ MessageSid: "SMin2", From: PEER, To: LINE, Body: "Hello?" });
    const thread = await s.threads.findByPeer(LINE, PEER);
    assertEquals(thread?.unreadCount, 2);
    assertEquals(thread?.lastPreview, "Hello?");
    assertEquals((await s.texts.listByThread(thread!.id)).map((t) => t.body), ["Are you open today?", "Hello?"]);
  } finally {
    await restore();
  }
});

Deno.test("REQ-899 receive-text int: the same MessageSid delivered twice is stored once", async () => {
  const { restore } = await freshLine();
  try {
    const s = await stores();
    const r = new ReceiveText(s.threads, s.texts);
    const a = await r.receive({ MessageSid: "SMdup", From: PEER, To: LINE, Body: "once" });
    const b = await r.receive({ MessageSid: "SMdup", From: PEER, To: LINE, Body: "once" });
    assertEquals(a.id, b.id);
    assertEquals((await s.threads.findByPeer(LINE, PEER))?.unreadCount, 1);
  } finally {
    await restore();
  }
});
