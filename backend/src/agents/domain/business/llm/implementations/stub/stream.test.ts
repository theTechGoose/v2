/**
 * REQ-670 (demo-loop cycle 5, p7): the stub LLM streams like the real one, so
 * the coordinator, the SSE route and the browser can be proved to stream
 * without a key — its text goes to the sink in pieces that join back to the
 * whole text, a tool call is told after the prose (as OpenAI sends it), and
 * the response is the same one a non-streamed call gets.
 */
import { assert, assertEquals } from "#std/assert";
import { StubLLMClient } from "./mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";

const ask = (content: string): LLMRequest => ({
  systemPrompt: "test system",
  messages: [{ role: "user", content }],
  userId: "u-1",
});

Deno.test("REQ-670 StubLLMClient: with a stream sink the echo goes out in several pieces that join to the whole text", async () => {
  const stub = new StubLLMClient();
  const pieces: string[] = [];
  const res = await stub.respond({
    ...ask("how do I keep a client happy when a job runs a day late"),
    stream: { text: (d) => pieces.push(d) },
  });
  assertEquals(
    res.text,
    "(stub) how do I keep a client happy when a job runs a day late",
  );
  assert(pieces.length >= 5, `streamed in pieces (got ${pieces.length})`);
  assertEquals(pieces.join(""), res.text);
});

Deno.test("REQ-670 StubLLMClient: a scripted reply with a tool call streams its prose, then tells the tool by name", async () => {
  const stub = new StubLLMClient();
  stub.setScript([{
    text: "Drafting it now.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Deck",
        lineItems: [{ description: "Deck", amountCents: 500_000 }],
      },
    },
  }]);
  const seen: string[] = [];
  const res = await stub.respond({
    ...ask("deck 12x16"),
    stream: {
      text: (d) => seen.push(`text:${d}`),
      tool: (n) => seen.push(`tool:${n}`),
    },
  });
  assertEquals(res.action?.type, "create_quote");
  assertEquals(seen[seen.length - 1], "tool:create_quote");
  assertEquals(
    seen.filter((s) => s.startsWith("text:")).map((s) => s.slice(5)).join(""),
    "Drafting it now.",
  );
});

Deno.test("REQ-670 StubLLMClient: no sink, or a JSON-mode call, streams nothing and answers the same", async () => {
  const stub = new StubLLMClient();
  const plain = await stub.respond(ask("hello"));
  assertEquals(plain.text, "(stub) hello");
  const pieces: string[] = [];
  const json = await stub.respond({
    ...ask("hello"),
    responseFormat: "json",
    stream: { text: (d) => pieces.push(d) },
  });
  assertEquals(json.text, "(stub) hello");
  assertEquals(pieces, []);
});
