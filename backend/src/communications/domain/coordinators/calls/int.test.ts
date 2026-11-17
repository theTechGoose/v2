/** REQ-900 — the call log. */
import "#reflect-metadata";
import { assertEquals, assertRejects } from "#std/assert";
import { NotFoundError } from "@core/data/repository/mod.ts";
import { freshLine, LINE, PEER, stores } from "../_test-support/mod.ts";
import { Calls } from "./mod.ts";

Deno.test("REQ-900 calls int: list is newest first on the line; get returns one with its transcript; missing → 404", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const s = await stores();
    const a = await s.calls.create({ line: LINE, peer: PEER, direction: "inbound", providerSid: "CAa", status: "completed", handledBy: "agent" });
    await new Promise((r) => setTimeout(r, 2));
    const b = await s.calls.create({ line: LINE, peer: "+15125550002", direction: "outbound", providerSid: "CAb", status: "completed", handledBy: "client" });
    await s.calls.create({ line: "+10000000000", peer: PEER, direction: "inbound", providerSid: "CAother", status: "completed", handledBy: "none" });
    await s.calls.appendTranscript(a.id, { role: "caller", text: "hi", at: new Date().toISOString() });
    const calls = new Calls(s.calls, cfg);
    assertEquals((await calls.list()).map((c) => c.id), [b.id, a.id]);
    assertEquals((await calls.get(a.id)).transcript.length, 1);
    await assertRejects(() => calls.get("nope"), NotFoundError);
  } finally {
    await restore();
  }
});
