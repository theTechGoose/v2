import { assert, assertEquals } from "#std/assert";
import { OpenAILLMClient } from "./mod.ts";

/**
 * Smoke tests for OpenAILLMClient — we pass a custom `fetch` into the
 * SDK constructor so requests are intercepted, the wire shape is
 * asserted, and a canned chat-completion response is returned. No real
 * OpenAI traffic; no API key needed in CI.
 *
 * These cover the contract between our client and the OpenAI Chat
 * Completions wire format. tools.test.ts separately covers the pure
 * parseToolCall function. Together they exercise the whole respond()
 * pipeline.
 */

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function makeMockFetch(handler: (call: CapturedCall) => Response): { fetch: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { headers[k] = v; });
    let body: unknown = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const text = await req.text();
      try { body = JSON.parse(text); } catch { body = text; }
    }
    const call: CapturedCall = { url: req.url, method: req.method, headers, body };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { fetch: mockFetch, calls };
}

function chatCompletion(content: string | null, toolCalls: { id: string; name: string; arguments: string }[] = []): Response {
  return new Response(JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "gpt-4o-mini",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content,
        tool_calls: toolCalls.length > 0
          ? toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } }))
          : undefined,
      },
      finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

Deno.test("OpenAILLMClient smoke: constructor throws when no API key is provided", () => {
  Deno.env.delete("OPENAI_API_KEY");
  let threw = false;
  try { new OpenAILLMClient(); } catch { threw = true; }
  assertEquals(threw, true);
});

Deno.test("OpenAILLMClient smoke: respond() sends Bearer auth + system prompt + history + tools", async () => {
  const mock = makeMockFetch(() => chatCompletion("Got it — what zip code is the job in?"));
  const client = new OpenAILLMClient({ apiKey: "sk-test-1234", fetch: mock.fetch });
  const out = await client.respond({
    systemPrompt: "system-prompt-here",
    messages: [
      { role: "user",      content: "Garage epoxy" },
      { role: "assistant", content: "Sure thing"   },
      { role: "user",      content: "Lock it in"   },
    ],
    userId: "u-1",
  });
  assertEquals(out.text, "Got it — what zip code is the job in?");
  assertEquals(out.action, undefined);

  assertEquals(mock.calls.length, 1);
  const call = mock.calls[0];
  assert(call.url.includes("/chat/completions"), `expected /chat/completions, got ${call.url}`);
  assertEquals(call.method, "POST");
  assertEquals(call.headers["authorization"], "Bearer sk-test-1234");

  const body = call.body as { model: string; messages: { role: string; content: string }[]; tools: { function: { name: string } }[] };
  assertEquals(body.model, "gpt-4o-mini");
  assertEquals(body.messages[0], { role: "system", content: "system-prompt-here" });
  assertEquals(body.messages[1].role, "user");
  assertEquals(body.messages[1].content, "Garage epoxy");
  assertEquals(body.messages[3].content, "Lock it in");
  assertEquals(body.tools.length, 3);
  assertEquals(body.tools.map((t) => t.function.name).sort(), ["create_quote", "lock_quote", "request_terms_transition"]);
});

Deno.test("OpenAILLMClient smoke: respond() inserts businessContext as a second system message", async () => {
  const mock = makeMockFetch(() => chatCompletion("noted"));
  const client = new OpenAILLMClient({ apiKey: "sk-test-1234", fetch: mock.fetch });
  await client.respond({
    systemPrompt: "primary",
    businessContext: "active customers: Tom & Linda K. with $3,400 quote draft",
    messages: [{ role: "user", content: "any updates?" }],
    userId: "u-1",
  });
  const body = mock.calls[0].body as { messages: { role: string; content: string }[] };
  assertEquals(body.messages[0].content, "primary");
  assertEquals(body.messages[1].role, "system");
  assert(body.messages[1].content.includes("active customers: Tom & Linda K."));
  assertEquals(body.messages[2].role, "user");
});

Deno.test("OpenAILLMClient smoke: tool_call → parsed into create_quote LLMAction", async () => {
  const mock = makeMockFetch(() => chatCompletion(
    "Drafting now.",
    [{
      id: "call_1",
      name: "create_quote",
      arguments: JSON.stringify({
        summary: "Quote: 2-Car Garage Epoxy Floor",
        customerId: "cust-1",
        lineItems: [
          { description: "Surface prep + grind", amountCents: 84_000 },
          { description: "Polyaspartic 3-coat",  amountCents: 168_000 },
        ],
      }),
    }],
  ));
  const client = new OpenAILLMClient({ apiKey: "sk-test-1234", fetch: mock.fetch });
  const out = await client.respond({
    systemPrompt: "p",
    messages: [{ role: "user", content: "draft the quote" }],
    userId: "u-1",
  });
  assertEquals(out.text, "Drafting now.");
  assertEquals(out.action?.type, "create_quote");
  if (out.action?.type === "create_quote") {
    assertEquals(out.action.payload.summary, "Quote: 2-Car Garage Epoxy Floor");
    assertEquals(out.action.payload.lineItems.length, 2);
  }
});

Deno.test("OpenAILLMClient smoke: tool_call without surrounding text gets a fallback line", async () => {
  const mock = makeMockFetch(() => chatCompletion(
    null,
    [{ id: "call_2", name: "lock_quote", arguments: JSON.stringify({ quoteId: "q-1" }) }],
  ));
  const client = new OpenAILLMClient({ apiKey: "sk-test-1234", fetch: mock.fetch });
  const out = await client.respond({
    systemPrompt: "p",
    messages: [{ role: "user", content: "lock it" }],
    userId: "u-1",
  });
  assertEquals(out.action?.type, "lock_quote");
  assertEquals(out.text, "Locking the quote.");        // fallback filler
});

Deno.test("OpenAILLMClient smoke: malformed tool args fall through to text-only response", async () => {
  const mock = makeMockFetch(() => chatCompletion(
    "Sure — but I need more info.",
    [{ id: "call_3", name: "create_quote", arguments: "{ not valid json" }],
  ));
  const client = new OpenAILLMClient({ apiKey: "sk-test-1234", fetch: mock.fetch });
  const out = await client.respond({
    systemPrompt: "p",
    messages: [{ role: "user", content: "go" }],
    userId: "u-1",
  });
  assertEquals(out.action, undefined);
  assertEquals(out.text, "Sure — but I need more info.");
});

Deno.test("OpenAILLMClient smoke: respects opts.model override", async () => {
  const mock = makeMockFetch(() => chatCompletion("ok"));
  const client = new OpenAILLMClient({ apiKey: "sk-test-1234", model: "gpt-4o", fetch: mock.fetch });
  await client.respond({ systemPrompt: "p", messages: [{ role: "user", content: "hi" }], userId: "u-1" });
  const body = mock.calls[0].body as { model: string };
  assertEquals(body.model, "gpt-4o");
});

Deno.test("OpenAILLMClient smoke: respects OPENAI_MODEL env var when no model opt is given", async () => {
  Deno.env.set("OPENAI_MODEL", "gpt-4o");
  try {
    const mock = makeMockFetch(() => chatCompletion("ok"));
    const client = new OpenAILLMClient({ apiKey: "sk-test-1234", fetch: mock.fetch });
    await client.respond({ systemPrompt: "p", messages: [{ role: "user", content: "hi" }], userId: "u-1" });
    const body = mock.calls[0].body as { model: string };
    assertEquals(body.model, "gpt-4o");
  } finally {
    Deno.env.delete("OPENAI_MODEL");
  }
});
