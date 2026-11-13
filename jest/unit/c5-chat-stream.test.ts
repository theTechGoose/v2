/**
 * REQ-670 — demo-loop cycle 5, issue p7 "Assistant replies never stream" (pairs 3
 * and 7, both sides of the demo), and the backlog's c1-nc-6, c2-nc-stream and
 * c4-nc-no-streaming. The chat awaited the whole JSON turn and then showed the
 * reply at once; the typing bubble was three dots with no words.
 *
 *   front-end/lib/chat-stream.ts   parseSse · pendingReply · pendingLabelKey ·
 *                                  readChatStream
 *   front-end/clients/assistant.ts assistantClient.chatStream (SSE, JSON fallback)
 *   front-end/islands/AsstChat.tsx the pending bubble shows the reply as it is
 *                                  written, else a visible label
 *   shared/quote-flow/step-composer.ts stepOwnsAnswer — Pick a price and the
 *                                  Job details picker cover the thread with
 *                                  their panel and show the turn on the step
 *                                  (REQ-442), so their step turns stay JSON
 *
 * Lazy-required so a missing export reds only the tests that use it.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cs = () => require("../../front-end/lib/chat-stream");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const timeout = () => require("../../shared/quote-flow/chat-timeout");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const steps = () => require("../../shared/quote-flow/step-composer");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const enc = new TextEncoder();
/** A body that arrives in exactly these pieces. */
function body(pieces: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of pieces) c.enqueue(enc.encode(p));
      c.close();
    },
  });
}
const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("REQ-670 parseSse — whole frames out of what has arrived so far", () => {
  it("REQ-670 splits whole frames and keeps an unfinished one for the next read", () => {
    const { parseSse } = cs();
    const out = parseSse(
      'event: delta\ndata: {"text":"Hi"}\n\nevent: delta\ndata: {"te',
    );
    expect(out.frames).toEqual([{ event: "delta", data: '{"text":"Hi"}' }]);
    expect(out.rest).toBe('event: delta\ndata: {"te');
    const next = parseSse(out.rest + 'xt":" there"}\n\n');
    expect(next.frames).toEqual([{
      event: "delta",
      data: '{"text":" there"}',
    }]);
    expect(next.rest).toBe("");
  });

  it("REQ-670 reads CRLF frames, skips comment lines, joins multi-line data", () => {
    const { parseSse } = cs();
    const out = parseSse(
      ": ping\r\n\r\nevent: text\r\ndata: a\r\ndata: b\r\n\r\n",
    );
    expect(out.frames).toEqual([{ event: "text", data: "a\nb" }]);
  });
});

describe("REQ-670 pendingReply — what the pending bubble shows", () => {
  it("REQ-670 a delta appends, a text replaces, a stage clears the prose and names itself", () => {
    const { pendingReply, NO_REPLY_YET } = cs();
    let s = NO_REPLY_YET;
    expect(s).toEqual({ text: "", stage: null });
    s = pendingReply(s, { type: "delta", text: "Most decks" });
    s = pendingReply(s, { type: "delta", text: " run $25" });
    expect(s).toEqual({ text: "Most decks run $25", stage: null });
    s = pendingReply(s, { type: "text", text: "Labor: about $1,200" });
    expect(s.text).toBe("Labor: about $1,200");
    s = pendingReply(s, { type: "progress", stage: "drafting" });
    expect(s).toEqual({ text: "", stage: "drafting" });
  });

  it("REQ-670 the label while no prose shows: thinking by default, else the stage — in en and es", () => {
    const { pendingLabelKey } = cs();
    expect(en[pendingLabelKey(null)]).toBe("Assistant is thinking…");
    expect(es[pendingLabelKey(null)]).toBe("El asistente está pensando…");
    expect(en[pendingLabelKey("pricing")]).toBe("Pricing the job…");
    expect(es[pendingLabelKey("pricing")]).toBe("Calculando el precio…");
    expect(en[pendingLabelKey("drafting")]).toBe("Drafting the quote…");
    expect(es[pendingLabelKey("drafting")]).toBe(
      "Preparando la cotización…",
    );
    expect(en[pendingLabelKey("saving")]).toBe("Saving…");
    expect(es[pendingLabelKey("saving")]).toBe("Guardando…");
  });

  it("REQ-670 en and es carry the same asstChat.reply.* keys", () => {
    const keys = (d: Record<string, string>) =>
      Object.keys(d).filter((k) => k.startsWith("asstChat.reply.")).sort();
    expect(keys(en)).toEqual([
      "asstChat.reply.drafting",
      "asstChat.reply.pricing",
      "asstChat.reply.saving",
      "asstChat.reply.thinking",
    ]);
    expect(keys(es)).toEqual(keys(en));
  });
});

describe("REQ-670 readChatStream — the turn's events as they arrive, then the whole turn", () => {
  const DONE = {
    conversation: { id: "c-1" },
    newMessages: [{ id: "m-2", role: "assistant", content: "About $30." }],
  };

  it("REQ-670 hands each event to onEvent in order, across chunk boundaries, and resolves with done", async () => {
    const { readChatStream } = cs();
    const all = frame("progress", { stage: "pricing" }) +
      frame("delta", { text: "About " }) + frame("delta", { text: "$30." }) +
      frame("done", DONE);
    // cut the bytes at awkward places
    const pieces = [
      all.slice(0, 7),
      all.slice(7, 40),
      all.slice(40, 41),
      all.slice(41),
    ];
    const seen: unknown[] = [];
    const turn = await readChatStream(
      body(pieces),
      (e: unknown) => seen.push(e),
    );
    expect(seen).toEqual([
      { type: "progress", stage: "pricing" },
      { type: "delta", text: "About " },
      { type: "delta", text: "$30." },
    ]);
    expect(turn).toEqual(DONE);
  });

  it("REQ-670 an error event rejects with its message; a server timeout is a TimeoutError (the chat's friendly message + Retry)", async () => {
    const { readChatStream } = cs();
    const { TimeoutError } = timeout();
    await expect(
      readChatStream(
        body([frame("error", { message: "quote store down", name: "Error" })]),
        () => {},
      ),
    ).rejects.toThrow("quote store down");
    const err = await readChatStream(
      body([
        frame("delta", { text: "Hi" }),
        frame("error", {
          message: "Chat turn timed out",
          name: "TimeoutError",
        }),
      ]),
      () => {},
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
  });

  it("REQ-670 a stream that ends without done rejects — never a silent empty turn", async () => {
    const { readChatStream } = cs();
    await expect(
      readChatStream(body([frame("delta", { text: "Hi" })]), () => {}),
    ).rejects.toThrow();
  });
});

describe("REQ-670 assistantClient.chatStream — the SSE route, with the JSON route as the fallback", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  // Required once, up front: compiling the client's import graph is slow on a
  // loaded machine, and it is not what these tests time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let assistantClient: any;
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    assistantClient =
      require("../../front-end/clients/assistant").assistantClient;
  }, 180_000);
  const client = () => assistantClient;

  it("REQ-670 posts to /agents/chat/stream asking for an event stream, streams the reply and resolves with the whole turn", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const DONE = { conversation: { id: "c-1" }, newMessages: [] };
    globalThis.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(
        new Response(
          body([
            frame("delta", { text: "Hel" }),
            frame("delta", { text: "lo" }),
            frame("done", DONE),
          ]),
          {
            status: 200,
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          },
        ),
      );
    }) as typeof fetch;
    const seen: unknown[] = [];
    const turn = await client().chatStream(
      { conversationId: "c-1", content: "hi", kind: "text" },
      (e: unknown) => seen.push(e),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/agents\/chat\/stream$/);
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).accept).toBe(
      "text/event-stream",
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      conversationId: "c-1",
      content: "hi",
      kind: "text",
    });
    expect(seen).toEqual([
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
    ]);
    expect(turn).toEqual(DONE);
  });

  it("REQ-670 a server without the stream route (404) is asked the JSON way — the turn still goes through, once", async () => {
    const urls: string[] = [];
    const DONE = { conversation: { id: "c-1" }, newMessages: [] };
    globalThis.fetch = ((url: string) => {
      urls.push(String(url));
      return Promise.resolve(
        /\/stream$/.test(String(url))
          ? new Response("{}", {
            status: 404,
            headers: { "content-type": "application/json" },
          })
          : new Response(JSON.stringify(DONE), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );
    }) as typeof fetch;
    const turn = await client().chatStream({ content: "hi" }, () => {});
    expect(urls.map((u) => u.replace(/^.*\/agents/, "/agents"))).toEqual([
      "/agents/chat/stream",
      "/agents/chat",
    ]);
    expect(turn).toEqual(DONE);
  });

  it("REQ-670 a refused turn (400) is an error, never a second send", async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      return Promise.resolve(
        new Response(
          JSON.stringify({ message: "chat requires non-empty content" }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    }) as typeof fetch;
    await expect(client().chatStream({ content: "" }, () => {})).rejects
      .toThrow();
    expect(calls).toBe(1);
  });
});

describe("REQ-670 AsstChat — the pending bubble streams, and has words while it waits", () => {
  const src = read("front-end/islands/AsstChat.tsx");

  it("REQ-670 typed and spoken messages, and a step message whose answer lands in the thread, go through the streamed turn", () => {
    const streamed = src.match(/assistantClient\.chatStream\(/g) ?? [];
    expect(streamed.length).toBeGreaterThanOrEqual(3);
    expect(src).not.toMatch(/assistantClient\.chat\(\{/);
  });

  it("REQ-670 a step that owns its answer asks the JSON way — its panel covers the thread, so nothing streamed would be seen, and the step says the turn in its own words", () => {
    const { stepOwnsAnswer } = steps();
    expect(stepOwnsAnswer("price")).toBe(true);
    expect(stepOwnsAnswer("job_details")).toBe(true);
    expect(stepOwnsAnswer("wizard")).toBe(false);
    expect(stepOwnsAnswer("review")).toBe(false);
    // the one JSON turn left in the island is that step's
    expect(src.match(/assistantClient\.chat\(/g) ?? []).toHaveLength(1);
    expect(src).toMatch(
      /stepOwnsAnswer\(step\)\s*\?\s*assistantClient\.chat\(/,
    );
    // the step composer shows the exchange on the same steps
    const comp = read("front-end/components/StepComposer.tsx");
    expect(comp).toMatch(/const ownsAnswer = stepOwnsAnswer\(step\)/);
  });

  it("REQ-670 the pending bubble shows the reply so far, else a visible label (no longer dots alone)", () => {
    const bubble = read("front-end/components/PendingReplyBubble.tsx");
    expect(bubble).toMatch(/data-cy="msg-streaming"/);
    expect(bubble).toMatch(/data-cy="msg-typing-label"/);
    expect(bubble).toMatch(/pendingLabelKey\(/);
    expect(src).toMatch(/<PendingReplyBubble reply=\{liveReply\}/);
  });

  it("REQ-670 a streamed piece re-renders the bubble, never the island: the live reply is a signal only the bubble reads", () => {
    expect(src).toMatch(/const liveReply = useSignal<PendingReply>\(/);
    expect(src).not.toMatch(/useState<PendingReply>/);
    expect(src).toMatch(
      /liveReply\.value = pendingReply\(liveReply\.peek\(\), event\)/,
    );
    // the island itself never reads it while rendering
    expect(src.match(/liveReply\.value(?! =)/g) ?? []).toHaveLength(0);
  });
});
