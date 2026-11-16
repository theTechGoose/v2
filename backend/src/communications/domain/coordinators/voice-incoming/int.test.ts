/** REQ-900 — the line was called: ring the softphones, log the inbound call. */
import "#reflect-metadata";
import { assertEquals, assertStringIncludes } from "#std/assert";
import { freshLine, LINE, PEER, stores } from "../_test-support/mod.ts";
import { VoiceIncoming } from "./mod.ts";

Deno.test("REQ-900 voice-incoming int: rings u_1 and u_2 for 20 s with action → unanswered; call logged ringing/inbound; thread touched (not unread yet)", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const s = await stores();
    const xml = await new VoiceIncoming(s.calls, s.threads, cfg).handle({ CallSid: "CAin", From: PEER, To: LINE, CallStatus: "ringing" });
    assertStringIncludes(xml, `<Dial timeout="20" action="https://api.test/communications/twilio/voice/unanswered" callerId="${PEER}">`);
    assertStringIncludes(xml, "<Client>u_1</Client><Client>u_2</Client>");
    const call = await s.calls.findBySid("CAin");
    assertEquals(call?.direction, "inbound");
    assertEquals(call?.status, "ringing");
    assertEquals(call?.handledBy, "none");
    const thread = await s.threads.findByPeer(LINE, PEER);
    assertEquals(thread?.lastPreview, "Incoming call");
    assertEquals(thread?.unreadCount, 0);
  } finally {
    await restore();
  }
});
