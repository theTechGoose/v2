/** REQ-900 — the softphone dialed a number: bridge it as the line, log the outbound call. */
import "#reflect-metadata";
import { assertEquals, assertStringIncludes } from "#std/assert";
import { freshLine, LINE, PEER, stores } from "../_test-support/mod.ts";
import { VoiceOutgoing } from "./mod.ts";

Deno.test("REQ-900 voice-outgoing int: Dial TwiML with callerId = line + status callback; call logged outbound, handled by client; thread touched", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const s = await stores();
    const xml = await new VoiceOutgoing(s.calls, s.threads, cfg).handle({ CallSid: "CAout", From: "client:u_1", To: "512-555-1234" });
    assertStringIncludes(xml, `<Dial callerId="${LINE}"`);
    assertStringIncludes(xml, `statusCallback="https://api.test/communications/twilio/voice/status"`);
    assertStringIncludes(xml, `>${PEER}</Number>`);
    const call = await s.calls.findBySid("CAout");
    assertEquals(call?.direction, "outbound");
    assertEquals(call?.peer, PEER);
    assertEquals(call?.handledBy, "client");
    assertEquals(call?.status, "initiated");
    assertEquals((await s.threads.findByPeer(LINE, PEER))?.lastPreview, "Outgoing call");
  } finally {
    await restore();
  }
});

Deno.test("REQ-900 voice-outgoing int: a missing or junk To is refused with <Say>, not a Dial", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const s = await stores();
    const xml = await new VoiceOutgoing(s.calls, s.threads, cfg).handle({ CallSid: "CAbad", From: "client:u_1", To: "nope" });
    assertStringIncludes(xml, "<Say>");
    assertEquals(xml.includes("<Dial"), false);
    assertEquals(await s.calls.findBySid("CAbad"), null);
  } finally {
    await restore();
  }
});
