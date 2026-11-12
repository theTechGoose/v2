/**
 * REQ-670 (demo-loop cycle 5, p7 — and the backlog's c1-nc-6, c2-nc-stream,
 * c4-nc-no-streaming): "Assistant replies never stream". OpenAILLMClient made
 * one whole chat completion per turn, so the chat showed nothing until the
 * whole turn was done (pairs 3 and 7, on both sides of the demo).
 *
 * With a `stream` sink the client asks for `stream: true`, hands each piece of
 * the model's prose to the sink as it arrives, holds a tool call back until it
 * is whole (the sink is only told that it started), and still returns the
 * same whole LLMResponse the coordinator settles. Without a sink — and for a
 * JSON-mode call — nothing changes.
 *
 * The SDK gets a fetch that answers with canned SSE chunks — no network, no
 * key (unit lane).
 */
import { assert, assertEquals } from "#std/assert";
import { OpenAILLMClient } from "./mod.ts";

type Delta = {
  role?: string;
  content?: string;
  tool_calls?: Record<string, unknown>[];
};

function chunk(delta: Delta, finish: string | null = null) {
  return {
    id: "chatcmpl-req670",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-4o-mini",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

const enc = new TextEncoder();
const frame = (c: unknown) => enc.encode(`data: ${JSON.stringify(c)}\n\n`);
const DONE = enc.encode("data: [DONE]\n\n");

/** An SSE answer whose chunks are written one by one; `before(i)` runs before
 *  chunk i is written (a test holds the rest back with it). */
function sse(
  chunks: unknown[],
  before: (i: number) => Promise<void> = () => Promise.resolve(),
): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(c) {
      for (let i = 0; i < chunks.length; i++) {
        await before(i);
        c.enqueue(frame(chunks[i]));
      }
      c.enqueue(DONE);
      c.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function completion(content: string): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-req670",
      object: "chat.completion",
      created: 1,
      model: "gpt-4o-mini",
      choices: [{
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** A client whose every request body is recorded; answers go out in order. */
function client(answers: Array<() => Response>) {
  const bodies: Record<string, unknown>[] = [];
  const llm = new OpenAILLMClient({
    apiKey: "sk-test-670",
    fetch: ((_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      const next = answers.shift();
      if (!next) return Promise.reject(new Error("unexpected extra call"));
      return Promise.resolve(next());
    }) as typeof fetch,
  });
  return { llm, bodies };
}

const ASK = {
  systemPrompt: "p",
  messages: [{
    role: "user" as const,
    content: "how much do decks usually run?",
  }],
  userId: "u-1",
};

Deno.test("REQ-670 OpenAILLMClient: with a stream sink it asks for stream:true and each piece of prose reaches the sink as it arrives — before the rest is sent", async () => {
  const pieces: string[] = [];
  const first = Promise.withResolvers<void>();
  const timer = setTimeout(
    () =>
      first.reject(
        new Error("the first piece never reached the sink before the rest"),
      ),
    3_000,
  );
  const { llm, bodies } = client([() =>
    sse(
      [
        chunk({ role: "assistant", content: "" }),
        chunk({ content: "Most decks " }),
        chunk({ content: "run $25 to $35 " }),
        chunk({ content: "a square foot." }),
        chunk({}, "stop"),
      ],
      // the rest of the answer is only written once the first words are out
      (i) => i === 3 ? first.promise : Promise.resolve(),
    )]);
  const out = await llm.respond({
    ...ASK,
    stream: {
      text: (d) => {
        pieces.push(d);
        if (pieces.length === 1) first.resolve();
      },
    },
  });
  clearTimeout(timer);

  assertEquals(bodies[0].stream, true, "the request asks for a stream");
  assertEquals(pieces, ["Most decks ", "run $25 to $35 ", "a square foot."]);
  assertEquals(out.text, "Most decks run $25 to $35 a square foot.");
  assertEquals(out.action, undefined);
  assertEquals(out.actions, undefined);
});

Deno.test("REQ-670 OpenAILLMClient: a tool call is held back — the prose before it streams, the sink is told the tool started (once), and the parsed call comes back whole", async () => {
  const pieces: string[] = [];
  const tools: string[] = [];
  const args = JSON.stringify({
    summary: "Deck build — 12x16 pressure-treated",
    lineItems: [{ description: "Deck build", amountCents: 640_000 }],
  });
  const { llm } = client([() =>
    sse([
      chunk({ role: "assistant", content: "" }),
      chunk({ content: "Drafting it now." }),
      chunk({
        tool_calls: [{
          index: 0,
          id: "call_0",
          type: "function",
          function: { name: "create_quote", arguments: "" },
        }],
      }),
      chunk({
        tool_calls: [{ index: 0, function: { arguments: args.slice(0, 20) } }],
      }),
      chunk({
        tool_calls: [{ index: 0, function: { arguments: args.slice(20) } }],
      }),
      chunk({}, "tool_calls"),
    ])]);
  const out = await llm.respond({
    ...ASK,
    tools: ["create_quote", "lock_quote"],
    stream: { text: (d) => pieces.push(d), tool: (n) => tools.push(n) },
  });

  assertEquals(pieces, ["Drafting it now."], "only the prose streamed");
  assertEquals(tools, ["create_quote"], "told once, by name");
  assertEquals(out.text, "Drafting it now.");
  assertEquals(out.action?.type, "create_quote");
  const p = out.action?.type === "create_quote" ? out.action.payload : null;
  assertEquals(p?.summary, "Deck build — 12x16 pressure-treated");
  assertEquals(p?.lineItems, [{
    description: "Deck build",
    amountCents: 640_000,
  }]);
  assertEquals(out.actions?.map((a) => a.type), ["create_quote"]);
});

Deno.test("REQ-670 OpenAILLMClient: two tool calls stream back as two parsed calls; the sink hears only the first start", async () => {
  const tools: string[] = [];
  const details = JSON.stringify({
    descriptionByLang: { en: "Plumbing permit", es: "Permiso de plomería" },
  });
  const permit = JSON.stringify({
    description: "Plumbing permit",
    deltaAmountCents: 45_000,
  });
  const { llm } = client([() =>
    sse([
      chunk({
        tool_calls: [{
          index: 0,
          id: "call_0",
          type: "function",
          function: { name: "update_job_details", arguments: details },
        }],
      }),
      chunk({
        tool_calls: [{
          index: 1,
          id: "call_1",
          type: "function",
          function: { name: "change_order", arguments: permit },
        }],
      }),
      chunk({}, "tool_calls"),
    ])]);
  const out = await llm.respond({
    ...ASK,
    tools: ["update_job_details", "change_order"],
    stream: { text: () => {}, tool: (n) => tools.push(n) },
  });
  assertEquals(tools, ["update_job_details"]);
  assertEquals(out.actions?.map((a) => a.type), [
    "update_job_details",
    "change_order",
  ]);
});

Deno.test("REQ-670 OpenAILLMClient: no stream sink → one whole completion, no stream asked for", async () => {
  const { llm, bodies } = client([
    () => completion("About $30 a square foot."),
  ]);
  const out = await llm.respond(ASK);
  assertEquals(bodies[0].stream, undefined);
  assertEquals(out.text, "About $30 a square foot.");
});

Deno.test("REQ-670 OpenAILLMClient: a JSON-mode call never streams, sink or not", async () => {
  const pieces: string[] = [];
  const { llm, bodies } = client([() => completion('{"options":[]}')]);
  const out = await llm.respond({
    ...ASK,
    responseFormat: "json",
    stream: { text: (d) => pieces.push(d) },
  });
  assertEquals(bodies[0].stream, undefined);
  assertEquals(pieces, []);
  assertEquals(out.text, '{"options":[]}');
});

Deno.test("REQ-670 OpenAILLMClient: an empty streamed answer is asked again once, and the second answer streams", async () => {
  const pieces: string[] = [];
  const { llm, bodies } = client([
    () => sse([chunk({ role: "assistant", content: "" }), chunk({}, "stop")]),
    () => sse([chunk({ content: "Hi " }), chunk({ content: "there." })]),
  ]);
  const out = await llm.respond({
    ...ASK,
    stream: { text: (d) => pieces.push(d) },
  });
  assertEquals(bodies.length, 2, "asked again once");
  assert(bodies.every((b) => b.stream === true), "both asks stream");
  assertEquals(pieces, ["Hi ", "there."]);
  assertEquals(out.text, "Hi there.");
});

Deno.test("REQ-670 OpenAILLMClient: a sink that throws never breaks the turn", async () => {
  const { llm } = client([
    () => sse([chunk({ content: "Still " }), chunk({ content: "answered." })]),
  ]);
  const out = await llm.respond({
    ...ASK,
    stream: {
      text: () => {
        throw new Error("the listener went away");
      },
    },
  });
  assertEquals(out.text, "Still answered.");
});
