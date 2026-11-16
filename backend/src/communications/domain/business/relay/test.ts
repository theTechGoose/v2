/** REQ-901 — the ConversationRelay protocol as a pure state machine. */
import { assertEquals } from "#std/assert";
import { initialRelayState, reduceRelay, replyEffects, RELAY_MAX_TURNS, END_CALL_MARKER } from "./mod.ts";

const setup = {
  type: "setup",
  sessionId: "VX1",
  accountSid: "AC1",
  callSid: "CA1",
  from: "+15125551234",
  to: "+18432588463",
  direction: "inbound",
  customParameters: { callId: "c_1" },
} as const;

Deno.test("REQ-901 relay: setup records the call identity and the custom parameters, with no effects", () => {
  const { state, effects } = reduceRelay(initialRelayState(), setup);
  assertEquals(state.callSid, "CA1");
  assertEquals(state.from, "+15125551234");
  assertEquals(state.callId, "c_1");
  assertEquals(effects, []);
});

Deno.test("REQ-901 relay: a partial prompt is ignored; the final prompt records the caller turn and asks the LLM once", () => {
  let s = reduceRelay(initialRelayState(), setup).state;
  const partial = reduceRelay(s, { type: "prompt", voicePrompt: "my name", lang: "en-US", last: false });
  assertEquals(partial.effects, []);
  assertEquals(partial.state.history, []);
  const final = reduceRelay(partial.state, { type: "prompt", voicePrompt: "my name is Ana", lang: "en-US", last: true });
  s = final.state;
  assertEquals(s.history, [{ role: "user", content: "my name is Ana" }]);
  assertEquals(final.effects, [
    { kind: "record", turn: { role: "caller", text: "my name is Ana", lang: "en-US" } },
    { kind: "ask-llm", history: [{ role: "user", content: "my name is Ana" }] },
  ]);
});

Deno.test("REQ-901 relay: replyEffects speaks the reply as one final token and records it; the end marker ends the session", () => {
  const s0 = reduceRelay(initialRelayState(), setup).state;
  const plain = replyEffects(s0, "Nice to meet you, Ana.");
  assertEquals(plain.effects, [
    { kind: "send", message: { type: "text", token: "Nice to meet you, Ana.", last: true } },
    { kind: "record", turn: { role: "agent", text: "Nice to meet you, Ana." } },
  ]);
  assertEquals(plain.state.history.at(-1), { role: "assistant", content: "Nice to meet you, Ana." });
  const bye = replyEffects(s0, `Goodbye! ${END_CALL_MARKER}`);
  assertEquals(bye.effects, [
    { kind: "send", message: { type: "text", token: "Goodbye!", last: true } },
    { kind: "record", turn: { role: "agent", text: "Goodbye!" } },
    { kind: "end", reason: "agent-ended" },
  ]);
  assertEquals(bye.state.ended, true);
});

Deno.test("REQ-901 relay: an interrupt truncates the stored agent turn to what the caller actually heard", () => {
  const s0 = replyEffects(reduceRelay(initialRelayState(), setup).state, "I can take your name, your number and the reason for your call.").state;
  const { state, effects } = reduceRelay(s0, { type: "interrupt", utteranceUntilInterrupt: "I can take your name,", durationUntilInterruptMs: 900 });
  assertEquals(state.history.at(-1), { role: "assistant", content: "I can take your name," });
  assertEquals(effects, [{ kind: "record", turn: { role: "agent", text: "I can take your name,", interrupted: true } }]);
});

Deno.test("REQ-901 relay: a DTMF digit is a caller turn; error and unknown frames do nothing", () => {
  const s0 = reduceRelay(initialRelayState(), setup).state;
  const dtmf = reduceRelay(s0, { type: "dtmf", digit: "1" });
  assertEquals(dtmf.state.history, [{ role: "user", content: "(pressed 1)" }]);
  assertEquals(dtmf.effects[1], { kind: "ask-llm", history: [{ role: "user", content: "(pressed 1)" }] });
  assertEquals(reduceRelay(s0, { type: "error", description: "64107 bad frame" }).effects, []);
  assertEquals(reduceRelay(s0, { type: "info", name: "configUpdated" } as never).effects, []);
});

Deno.test("REQ-901 relay: after the turn cap the session ends instead of asking the LLM again", () => {
  let s = reduceRelay(initialRelayState(), setup).state;
  for (let i = 0; i < RELAY_MAX_TURNS; i++) {
    s = reduceRelay(s, { type: "prompt", voicePrompt: `turn ${i}`, lang: "en-US", last: true }).state;
    s = replyEffects(s, "ok").state;
  }
  const over = reduceRelay(s, { type: "prompt", voicePrompt: "one more", lang: "en-US", last: true });
  assertEquals(over.effects.at(-1), { kind: "end", reason: "turn-cap" });
  assertEquals(over.state.ended, true);
  // once ended, nothing else happens
  assertEquals(reduceRelay(over.state, { type: "prompt", voicePrompt: "hello?", lang: "en-US", last: true }).effects, []);
});
