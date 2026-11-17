/** REQ-900 — Twilio's call status callbacks keep the log current, for our leg or the dialed child leg. */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { freshLine, LINE, PEER, stores } from "../_test-support/mod.ts";
import { CallStatus } from "./mod.ts";

Deno.test("REQ-900 call-status int: in-progress stamps startedAt; completed stamps endedAt + duration; a child leg patches via ParentCallSid; unknown → null", async () => {
  const { restore } = await freshLine();
  try {
    const s = await stores();
    await s.calls.create({ line: LINE, peer: PEER, direction: "outbound", providerSid: "CAparent", status: "initiated", handledBy: "client" });
    const cs = new CallStatus(s.calls);
    const live = await cs.apply({ CallSid: "CAchild", ParentCallSid: "CAparent", CallStatus: "in-progress", Timestamp: "Sun, 16 Nov 2026 15:00:00 +0000" });
    assertEquals(live?.status, "in-progress");
    assertEquals(live?.startedAt, "2026-11-16T15:00:00.000Z");
    const done = await cs.apply({ CallSid: "CAchild", ParentCallSid: "CAparent", CallStatus: "completed", CallDuration: "42", Timestamp: "Sun, 16 Nov 2026 15:00:42 +0000" });
    assertEquals(done?.status, "completed");
    assertEquals(done?.durationSec, 42);
    assertEquals(done?.endedAt, "2026-11-16T15:00:42.000Z");
    assertEquals(await cs.apply({ CallSid: "CAnope", CallStatus: "completed" }), null);
  } finally {
    await restore();
  }
});
