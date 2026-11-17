/** REQ-901 — the <Connect> action: the relay session's outcome lands on the call, then hang up. */
import "#reflect-metadata";
import { assertEquals, assertStringIncludes } from "#std/assert";
import { freshLine, LINE, PEER, stores } from "../_test-support/mod.ts";
import { RelayDone } from "./mod.ts";

Deno.test("REQ-901 relay-done int: stores SessionStatus + HandoffData and answers Hangup; unknown call still hangs up", async () => {
  const { restore } = await freshLine();
  try {
    const s = await stores();
    const call = await s.calls.create({ line: LINE, peer: PEER, direction: "inbound", providerSid: "CA1", status: "in-progress", handledBy: "agent" });
    const xml = await new RelayDone(s.calls).handle({ CallSid: "CA1", SessionStatus: "ended", HandoffData: '{"reasonCode":"agent-ended"}' });
    assertStringIncludes(xml, "<Hangup/>");
    const stored = await s.calls.get(call.id);
    assertEquals(stored.relayStatus, "ended");
    assertEquals(stored.handoffData, '{"reasonCode":"agent-ended"}');
    assertStringIncludes(await new RelayDone(s.calls).handle({ CallSid: "CAghost", SessionStatus: "failed" }), "<Hangup/>");
  } finally {
    await restore();
  }
});
