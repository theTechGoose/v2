import { assertEquals } from "#std/assert";
import { StubLLMClient } from "./mod.ts";
import type { LLMRequest, LLMResponse } from "@agents/domain/business/llm/base/mod.ts";

function makeReq(content: string): LLMRequest {
  return {
    systemPrompt: "test system",
    messages: [{ role: "user", content }],
    userId: "u-1",
  };
}

Deno.test("StubLLMClient: default mode echoes the latest user message", async () => {
  const stub = new StubLLMClient();
  const res = await stub.respond(makeReq("hello"));
  assertEquals(res.text, "(stub) hello");
  assertEquals(res.action, undefined);
});

Deno.test("StubLLMClient: default mode picks the LATEST user message when many", async () => {
  const stub = new StubLLMClient();
  const res = await stub.respond({
    systemPrompt: "x",
    userId: "u-1",
    messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: "ack" },
      { role: "user", content: "second" },
    ],
  });
  assertEquals(res.text, "(stub) second");
});

Deno.test("StubLLMClient: default mode handles message list with no user turn", async () => {
  const stub = new StubLLMClient();
  const res = await stub.respond({
    systemPrompt: "x",
    userId: "u-1",
    messages: [{ role: "assistant", content: "hi" }],
  });
  // No user message → falls back to empty content.
  assertEquals(res.text, "(stub) ");
});

Deno.test("StubLLMClient: scripted mode returns canned responses in order", async () => {
  const stub = new StubLLMClient();
  const scripted: LLMResponse[] = [
    { text: "first reply" },
    { text: "second reply", action: { type: "lock_quote", payload: { quoteId: "q-1" } } },
  ];
  stub.setScript(scripted);
  const a = await stub.respond(makeReq("anything"));
  assertEquals(a.text, "first reply");
  const b = await stub.respond(makeReq("anything"));
  assertEquals(b.text, "second reply");
  assertEquals(b.action?.type, "lock_quote");
});

Deno.test("StubLLMClient: script falls through to echo once exhausted", async () => {
  const stub = new StubLLMClient();
  stub.setScript([{ text: "only one" }]);
  const first = await stub.respond(makeReq("hello"));
  assertEquals(first.text, "only one");
  const second = await stub.respond(makeReq("again"));
  // After script empty, the default echo path runs.
  assertEquals(second.text, "(stub) again");
});

Deno.test("StubLLMClient: setScript copies the array (caller mutation is isolated)", async () => {
  const stub = new StubLLMClient();
  const arr: LLMResponse[] = [{ text: "a" }, { text: "b" }];
  stub.setScript(arr);
  arr.length = 0;                                          // mutate caller's copy
  const r = await stub.respond(makeReq("x"));
  assertEquals(r.text, "a");                               // stub still has its own copy
});

Deno.test("StubLLMClient: handler mode receives the request and returns the response", async () => {
  const stub = new StubLLMClient();
  const seen: LLMRequest[] = [];
  stub.setHandler((req) => {
    seen.push(req);
    return { text: "handler reply", action: { type: "request_terms_transition", payload: { quoteId: "q-7" } } };
  });
  const res = await stub.respond(makeReq("hi"));
  assertEquals(res.text, "handler reply");
  assertEquals(res.action?.type, "request_terms_transition");
  assertEquals(seen.length, 1);
  assertEquals(seen[0].userId, "u-1");
});

Deno.test("StubLLMClient: handler can be async", async () => {
  const stub = new StubLLMClient();
  stub.setHandler(async (_req) => {
    await new Promise((r) => setTimeout(r, 0));
    return { text: "async handler" };
  });
  const res = await stub.respond(makeReq("hi"));
  assertEquals(res.text, "async handler");
});

Deno.test("StubLLMClient: handler takes precedence over script", async () => {
  const stub = new StubLLMClient();
  stub.setScript([{ text: "from-script" }]);
  stub.setHandler(() => ({ text: "from-handler" }));
  const res = await stub.respond(makeReq("hi"));
  assertEquals(res.text, "from-handler");
});

Deno.test("StubLLMClient: reset() clears both script and handler", async () => {
  const stub = new StubLLMClient();
  stub.setScript([{ text: "scripted" }]);
  stub.setHandler(() => ({ text: "handled" }));
  stub.reset();
  const res = await stub.respond(makeReq("plain"));
  assertEquals(res.text, "(stub) plain");                  // back to default echo
});
