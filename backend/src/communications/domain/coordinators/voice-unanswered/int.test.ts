/** REQ-900/901 — after the ring: an answered call hangs up; otherwise exactly one fallback arm. */
import "#reflect-metadata";
import { assertEquals, assertStringIncludes } from "#std/assert";
import { freshLine, LINE, PEER, stores } from "../_test-support/mod.ts";
import { VoiceIncoming } from "../voice-incoming/mod.ts";
import { VoiceUnanswered } from "./mod.ts";

async function ringThen(dialStatus: string, env: Record<string, string | undefined>) {
  const { restore, cfg } = await freshLine(env);
  const s = await stores();
  await new VoiceIncoming(s.calls, s.threads, cfg).handle({ CallSid: "CAin", From: PEER, To: LINE, CallStatus: "ringing" });
  const xml = await new VoiceUnanswered(s.calls, s.threads, cfg).handle({ CallSid: "CAin", From: PEER, To: LINE, DialCallStatus: dialStatus });
  const call = await s.calls.findBySid("CAin");
  const thread = await s.threads.findByPeer(LINE, PEER);
  await restore();
  return { xml, call: call!, thread: thread! };
}

Deno.test("REQ-900 voice-unanswered int: the softphone took it → Hangup, handledBy client, nothing unread", async () => {
  const { xml, call, thread } = await ringThen("completed", { COMMS_FALLBACK: "agent" });
  assertStringIncludes(xml, "<Hangup/>");
  assertEquals(call.handledBy, "client");
  assertEquals(thread.unreadCount, 0);
});

Deno.test("REQ-901 voice-unanswered int: agent → ConversationRelay on our wss url with the call id; missed call marks the thread unread", async () => {
  const { xml, call, thread } = await ringThen("no-answer", { COMMS_FALLBACK: "agent" });
  assertStringIncludes(xml, '<ConversationRelay url="wss://api.test/communications/voice/relay"');
  assertStringIncludes(xml, '<Connect action="https://api.test/communications/twilio/voice/relay-done">');
  assertStringIncludes(xml, `<Parameter name="callId" value="${call.id}"/>`);
  assertEquals(call.handledBy, "agent");
  assertEquals(thread.unreadCount, 1);
  assertEquals(thread.lastPreview, "Missed call");
});

Deno.test("REQ-900 voice-unanswered int: voicemail (the default) → Record with the recording callback", async () => {
  const { xml, call } = await ringThen("busy", { COMMS_FALLBACK: undefined });
  assertStringIncludes(xml, '<Record maxLength="120" playBeep="true" recordingStatusCallback="https://api.test/communications/twilio/voice/recording"/>');
  assertEquals(call.handledBy, "voicemail");
});

Deno.test("REQ-900 voice-unanswered int: forward → Dial the configured phone as the line; forward without a number → voicemail", async () => {
  const fwd = await ringThen("no-answer", { COMMS_FALLBACK: "forward", COMMS_FORWARD_TO: "+15125550000" });
  assertStringIncludes(fwd.xml, `<Dial callerId="${LINE}"><Number>+15125550000</Number></Dial>`);
  assertEquals(fwd.call.handledBy, "forward");
  const vm = await ringThen("no-answer", { COMMS_FALLBACK: "forward", COMMS_FORWARD_TO: undefined });
  assertStringIncludes(vm.xml, "<Record");
});

Deno.test("REQ-900 voice-unanswered int: an unknown CallSid still answers TwiML (hangup) instead of erroring", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const s = await stores();
    const xml = await new VoiceUnanswered(s.calls, s.threads, cfg).handle({ CallSid: "CAghost", From: PEER, To: LINE, DialCallStatus: "no-answer" });
    assertStringIncludes(xml, "<Response>");
  } finally {
    await restore();
  }
});
