/** REQ-901 — one ConversationRelay session: frames in, spoken tokens out, transcript persisted, end when the agent says so. */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import type { LLMClient, LLMRequest, LLMResponse } from "@agents/domain/business/llm/base/mod.ts";
import { freshLine, LINE, PEER, stores } from "../_test-support/mod.ts";
import { RelaySession } from "./mod.ts";

class ScriptedLlm implements LLMClient {
  requests: LLMRequest[] = [];
  replies: string[] = [];
  respond(req: LLMRequest): Promise<LLMResponse> {
    this.requests.push(req);
    return Promise.resolve({ text: this.replies.shift() ?? "(no script)" });
  }
}

Deno.test("REQ-901 relay-session int: setup → prompt → text token; the transcript lands on the call; [END_CALL] sends end", async () => {
  const { restore, cfg } = await freshLine({ COMMS_AGENT_PROMPT: "You are the test receptionist." });
  try {
    const s = await stores();
    const call = await s.calls.create({ line: LINE, peer: PEER, direction: "inbound", providerSid: "CA1", status: "in-progress", handledBy: "agent" });
    const llm = new ScriptedLlm();
    llm.replies = ["Hi Ana, what's the best number to reach you?", "Got it. Someone will call you back shortly. Goodbye! [END_CALL]"];
    const relay = new RelaySession(s.calls, llm, cfg);
    const session = relay.start();

    const setup = await relay.handleFrame(session, JSON.stringify({ type: "setup", sessionId: "VX1", callSid: "CA1", from: PEER, to: LINE, customParameters: { callId: call.id } }));
    assertEquals(setup, { outbound: [], end: false });

    const partial = await relay.handleFrame(session, JSON.stringify({ type: "prompt", voicePrompt: "my name", lang: "en-US", last: false }));
    assertEquals(partial.outbound, []);

    const first = await relay.handleFrame(session, JSON.stringify({ type: "prompt", voicePrompt: "My name is Ana", lang: "en-US", last: true }));
    assertEquals(first, { outbound: [JSON.stringify({ type: "text", token: "Hi Ana, what's the best number to reach you?", last: true })], end: false });
    assertEquals(llm.requests[0].systemPrompt.startsWith("You are the test receptionist."), true);
    assertEquals(llm.requests[0].messages, [{ role: "user", content: "My name is Ana" }]);

    const second = await relay.handleFrame(session, JSON.stringify({ type: "prompt", voicePrompt: "512 555 1234", lang: "en-US", last: true }));
    assertEquals(second.outbound, [
      JSON.stringify({ type: "text", token: "Got it. Someone will call you back shortly. Goodbye!", last: true }),
      JSON.stringify({ type: "end" }),
    ]);
    assertEquals(second.end, true);
    assertEquals(llm.requests[1].messages.map((m) => m.role), ["user", "assistant", "user"]);

    const stored = await s.calls.get(call.id);
    assertEquals(stored.transcript.map((t) => [t.role, t.text]), [
      ["caller", "My name is Ana"],
      ["agent", "Hi Ana, what's the best number to reach you?"],
      ["caller", "512 555 1234"],
      ["agent", "Got it. Someone will call you back shortly. Goodbye!"],
    ]);
  } finally {
    await restore();
  }
});

Deno.test("REQ-901 relay-session int: an interrupt rewrites the last agent turn; a bad frame and an LLM failure never kill the session", async () => {
  const { restore, cfg } = await freshLine();
  try {
    const s = await stores();
    const call = await s.calls.create({ line: LINE, peer: PEER, direction: "inbound", providerSid: "CA2", status: "in-progress", handledBy: "agent" });
    const llm = new ScriptedLlm();
    llm.replies = ["I can take your name, your number and the reason for your call."];
    const relay = new RelaySession(s.calls, llm, cfg);
    const session = relay.start();
    await relay.handleFrame(session, JSON.stringify({ type: "setup", sessionId: "VX2", callSid: "CA2", from: PEER, to: LINE, customParameters: { callId: call.id } }));
    await relay.handleFrame(session, JSON.stringify({ type: "prompt", voicePrompt: "hello", lang: "en-US", last: true }));
    await relay.handleFrame(session, JSON.stringify({ type: "interrupt", utteranceUntilInterrupt: "I can take your name,", durationUntilInterruptMs: 700 }));
    assertEquals((await s.calls.get(call.id)).transcript.at(-1), { role: "agent", text: "I can take your name,", at: (await s.calls.get(call.id)).transcript.at(-1)!.at, interrupted: true });

    assertEquals(await relay.handleFrame(session, "{not json"), { outbound: [], end: false });

    const failing = { respond: () => Promise.reject(new Error("llm down")) } as unknown as LLMClient;
    const r2 = new RelaySession(s.calls, failing, cfg);
    const s2 = r2.start();
    await r2.handleFrame(s2, JSON.stringify({ type: "setup", sessionId: "VX3", callSid: "CA2", from: PEER, to: LINE, customParameters: { callId: call.id } }));
    const out = await r2.handleFrame(s2, JSON.stringify({ type: "prompt", voicePrompt: "hi", lang: "en-US", last: true }));
    assertEquals(out.end, false);
    assertEquals(out.outbound.length, 1);
    assertEquals(JSON.parse(out.outbound[0]).type, "text");
  } finally {
    await restore();
  }
});
