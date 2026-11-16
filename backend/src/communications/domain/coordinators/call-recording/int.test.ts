/** REQ-900 — a finished recording (voicemail or call) attaches to its call. */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { freshLine, LINE, PEER, stores } from "../_test-support/mod.ts";
import { CallRecording } from "./mod.ts";

Deno.test("REQ-900 call-recording int: completed → sid, url, duration on the call; in-progress ignored; unknown → null", async () => {
  const { restore } = await freshLine();
  try {
    const s = await stores();
    await s.calls.create({ line: LINE, peer: PEER, direction: "inbound", providerSid: "CA1", status: "completed", handledBy: "voicemail" });
    const cr = new CallRecording(s.calls);
    assertEquals(await cr.apply({ CallSid: "CA1", RecordingSid: "RE1", RecordingUrl: "https://api.twilio.com/r/RE1", RecordingStatus: "in-progress" }), null);
    const done = await cr.apply({ CallSid: "CA1", RecordingSid: "RE1", RecordingUrl: "https://api.twilio.com/r/RE1", RecordingDuration: "17", RecordingStatus: "completed" });
    assertEquals(done?.recordingSid, "RE1");
    assertEquals(done?.recordingUrl, "https://api.twilio.com/r/RE1");
    assertEquals(done?.recordingDurationSec, 17);
    assertEquals(await cr.apply({ CallSid: "CAnope", RecordingSid: "RE2", RecordingUrl: "u", RecordingStatus: "completed" }), null);
  } finally {
    await restore();
  }
});
