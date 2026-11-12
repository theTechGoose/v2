/**
 * REQ-670 (demo-loop cycle 5, p7 — "Assistant replies never stream"): the
 * pieces of a streamed chat turn.
 *
 *   - turnChannel: the turn's events. The reply's prose as the bubble should
 *     show it (shaped the way the stored reply is — plain text, no "who's this
 *     for?"): `delta` while it only grows, `text` when shaping rewrote what was
 *     shown. What the turn is doing (pricing / drafting / saving) as
 *     `progress`, said once in a row; a tool call starting is drafting
 *     (create_quote) or saving (anything else).
 *   - sseTurn: the turn as a text/event-stream — its events as they happen,
 *     then `done` with the whole turn, or `error`.
 */
import { assert, assertEquals } from "#std/assert";
import { TimeoutError } from "#quote-flow/chat-timeout.ts";
import { type ChatTurnEvent, sseFrame, sseTurn, turnChannel } from "./mod.ts";

function recorder() {
  const events: ChatTurnEvent[] = [];
  return { events, channel: turnChannel((e) => events.push(e)) };
}

const unbold = (raw: string) => raw.replace(/\*\*([^*\n]+)\*\*/g, "$1").trim();

Deno.test("REQ-670 turnChannel: prose that only grows goes out as deltas of the shaped text", () => {
  const { events, channel } = recorder();
  const sink = channel.prose(unbold);
  sink.text("Most decks ");
  sink.text("run $25 ");
  sink.text("a square foot.");
  assertEquals(events, [
    { type: "delta", text: "Most decks" },
    { type: "delta", text: " run $25" },
    { type: "delta", text: " a square foot." },
  ]);
});

Deno.test("REQ-670 turnChannel: when shaping rewrites what was shown the whole text goes out — the bubble never keeps raw markdown", () => {
  const { events, channel } = recorder();
  const sink = channel.prose(unbold);
  sink.text("Labor: ");
  sink.text("**about");
  sink.text(" $1,200**");
  assertEquals(events, [
    { type: "delta", text: "Labor:" },
    { type: "delta", text: " **about" },
    { type: "text", text: "Labor: about $1,200" },
  ]);
});

Deno.test("REQ-670 turnChannel: blank or unchanged prose sends nothing", () => {
  const { events, channel } = recorder();
  const sink = channel.prose(unbold);
  sink.text("   ");
  sink.text("\n");
  sink.text("Hi");
  sink.text(" ");
  assertEquals(events, [{ type: "delta", text: "Hi" }]);
});

Deno.test("REQ-670 turnChannel: a tool call starting is drafting for create_quote and saving for anything else", () => {
  const a = recorder();
  a.channel.prose(unbold).tool?.("create_quote");
  assertEquals(a.events, [{ type: "progress", stage: "drafting" }]);
  const b = recorder();
  b.channel.prose(unbold).tool?.("change_order");
  assertEquals(b.events, [{ type: "progress", stage: "saving" }]);
});

Deno.test("REQ-670 turnChannel: a stage is said once in a row; after one, prose starts from an empty bubble", () => {
  const { events, channel } = recorder();
  const sink = channel.prose(unbold);
  sink.text("Let me check.");
  channel.stage("pricing");
  channel.stage("pricing");
  channel.prose(unbold).text("Let me check the prices.");
  channel.stage("pricing");
  channel.stage("saving");
  assertEquals(events, [
    { type: "delta", text: "Let me check." },
    { type: "progress", stage: "pricing" },
    { type: "delta", text: "Let me check the prices." },
    { type: "progress", stage: "saving" },
  ]);
});

Deno.test("REQ-670 turnChannel: a listener that throws never breaks the turn", () => {
  const channel = turnChannel(() => {
    throw new Error("the client went away");
  });
  channel.prose(unbold).text("still fine");
  channel.stage("saving");
});

Deno.test("REQ-670 sseFrame: one event, its JSON on one data line, a blank line after", () => {
  assertEquals(
    sseFrame("delta", { text: "two\nlines" }),
    'event: delta\ndata: {"text":"two\\nlines"}\n\n',
  );
});

async function frames(
  res: Response,
): Promise<{ event: string; data: unknown }[]> {
  const raw = await res.text();
  return raw.split("\n\n").filter((f) => f.trim()).map((f) => {
    const event = /^event: (.*)$/m.exec(f)?.[1] ?? "";
    const data = /^data: (.*)$/m.exec(f)?.[1] ?? "null";
    return { event, data: JSON.parse(data) };
  });
}

Deno.test("REQ-670 sseTurn: a text/event-stream of the turn's events as they happen, then done with the whole turn", async () => {
  const res = sseTurn((emit) => {
    emit({ type: "progress", stage: "pricing" });
    emit({ type: "delta", text: "About " });
    emit({ type: "delta", text: "$30." });
    return Promise.resolve({ conversation: { id: "c-1" }, newMessages: [] });
  });
  assertEquals(res.status, 200);
  assert(
    (res.headers.get("content-type") ?? "").startsWith("text/event-stream"),
  );
  assert((res.headers.get("cache-control") ?? "").includes("no-transform"));
  assertEquals(await frames(res), [
    { event: "progress", data: { stage: "pricing" } },
    { event: "delta", data: { text: "About " } },
    { event: "delta", data: { text: "$30." } },
    {
      event: "done",
      data: { conversation: { id: "c-1" }, newMessages: [] },
    },
  ]);
});

Deno.test("REQ-670 sseTurn: the headers go out before the turn ends — the first event arrives while the turn still runs", async () => {
  const finish = Promise.withResolvers<{ ok: boolean }>();
  const res = sseTurn((emit) => {
    emit({ type: "delta", text: "Hi" });
    return finish.promise;
  });
  const reader = res.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assertEquals(first, 'event: delta\ndata: {"text":"Hi"}\n\n');
  finish.resolve({ ok: true });
  const rest = new TextDecoder().decode((await reader.read()).value);
  assertEquals(rest, 'event: done\ndata: {"ok":true}\n\n');
  assertEquals((await reader.read()).done, true);
});

Deno.test("REQ-670 sseTurn: a turn that fails ends with an error event; a timeout keeps its name so the chat offers Retry", async () => {
  const failed = await frames(
    sseTurn(() => Promise.reject(new Error("quote store down"))),
  );
  assertEquals(failed, [{
    event: "error",
    data: { message: "quote store down", name: "Error" },
  }]);
  const timedOut = await frames(
    sseTurn(() => Promise.reject(new TimeoutError("Chat turn timed out"))),
  );
  assertEquals(timedOut, [{
    event: "error",
    data: { message: "Chat turn timed out", name: "TimeoutError" },
  }]);
});

Deno.test("REQ-670 sseTurn: the turn runs to its end when the client goes away mid-stream", async () => {
  const gate = Promise.withResolvers<void>();
  const ended = Promise.withResolvers<string>();
  const res = sseTurn(async (emit) => {
    emit({ type: "delta", text: "Hi" });
    await gate.promise;
    emit({ type: "delta", text: " there" }); // nobody is listening any more
    ended.resolve("saved");
    return { ok: true };
  });
  await res.body!.cancel();
  gate.resolve();
  assertEquals(await ended.promise, "saved");
});
