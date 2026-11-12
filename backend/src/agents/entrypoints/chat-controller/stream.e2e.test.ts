/**
 * REQ-670 (demo-loop cycle 5, p7 — "Assistant replies never stream"; the
 * backlog's c1-nc-6, c2-nc-stream, c4-nc-no-streaming), over HTTP:
 * POST /agents/chat/stream answers text/event-stream. The reply arrives as
 * `delta` events while the model writes it — over the wire, not after the
 * turn — then `done` carries the same whole turn POST /agents/chat returns
 * (which stays, as the fallback). A request the JSON route refuses (no
 * session, no content) is refused the same way, before any stream starts.
 *
 * The stub LLM streams its echo word by word, a few ms apart, like a model.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);

async function drain(res: Response) {
  await res.body?.cancel();
}

async function withServer(fn: (port: number) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(PORT);
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(port: number, phone = "+15125556701"): Promise<string> {
  await drain(
    await fetch(`http://localhost:${port}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
    }),
  );
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

interface Frame {
  event: string;
  data: Record<string, unknown>;
  at: number;
}

/** Read the stream as it arrives; each frame stamped with when it was read. */
async function readFrames(res: Response): Promise<Frame[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const out: Frame[] = [];
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.trim()) continue;
      const event = /^event: (.*)$/m.exec(part)?.[1] ?? "message";
      const data = JSON.parse(/^data: (.*)$/m.exec(part)?.[1] ?? "null");
      out.push({ event, data, at: performance.now() });
    }
  }
  return out;
}

const ASK =
  "how do I keep a client happy when a job runs a day or two past the date we agreed on";

Deno.test("REQ-670 POST /agents/chat/stream: the reply arrives as delta events over the wire while it is written, then done carries the saved turn", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const res = await fetch(`http://localhost:${port}/agents/chat/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-session-id": sid,
      },
      body: JSON.stringify({ content: ASK }),
    });
    assertEquals(res.status, 200);
    assert(
      (res.headers.get("content-type") ?? "").startsWith("text/event-stream"),
      `content-type: ${res.headers.get("content-type")}`,
    );
    const frames = await readFrames(res);

    const deltas = frames.filter((f) => f.event === "delta");
    const done = frames.find((f) => f.event === "done");
    assert(deltas.length >= 5, `streamed in pieces (got ${deltas.length})`);
    assert(done, `no done event: ${frames.map((f) => f.event).join(",")}`);
    assertEquals(frames[frames.length - 1].event, "done", "done is last");
    // over the wire as it was written — not all at once after the turn
    assert(
      done!.at - deltas[0].at >= 100,
      `the first words came ${
        Math.round(done!.at - deltas[0].at)
      } ms before the turn ended`,
    );

    const turn = done!.data as {
      conversation: { id: string; currentPhase: string };
      newMessages: { role: string; kind: string; content: string }[];
    };
    assertEquals(typeof turn.conversation.id, "string");
    assertEquals(turn.newMessages.map((m) => m.role), ["user", "assistant"]);
    const reply = turn.newMessages[1].content;
    assertEquals(reply, `(stub) ${ASK}`);
    assertEquals(
      deltas.map((f) => f.data.text).join(""),
      reply,
      "the deltas join to the saved reply",
    );

    // the turn is saved like any other
    const snap = await fetch(
      `http://localhost:${port}/agents/conversations/${turn.conversation.id}`,
      { headers: { "x-session-id": sid } },
    ).then((r) => r.json());
    assertEquals(
      snap.messages.map((m: { content: string }) => m.content),
      [ASK, reply],
    );
  });
});

Deno.test("REQ-670 POST /agents/chat/stream continues a thread like the JSON route — and the JSON route still answers (the fallback)", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const headers = { "content-type": "application/json", "x-session-id": sid };
    const first = await fetch(`http://localhost:${port}/agents/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "first" }),
    }).then((r) => r.json());
    assertEquals(first.newMessages.length, 2, "the JSON route still answers");

    const res = await fetch(`http://localhost:${port}/agents/chat/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        conversationId: first.conversation.id,
        content: "second",
      }),
    });
    const frames = await readFrames(res);
    const done = frames.find((f) => f.event === "done")!.data as {
      conversation: { id: string };
    };
    assertEquals(done.conversation.id, first.conversation.id);
    const snap = await fetch(
      `http://localhost:${port}/agents/conversations/${first.conversation.id}`,
      { headers: { "x-session-id": sid } },
    ).then((r) => r.json());
    assertEquals(snap.messages.length, 4);
  });
});

Deno.test("REQ-670 POST /agents/chat/stream refuses what the JSON route refuses, before any stream starts", async () => {
  await withServer(async (port) => {
    const noSession = await fetch(
      `http://localhost:${port}/agents/chat/stream`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "no auth" }),
      },
    );
    const noSessionOk = noSession.ok;
    const noSessionType = noSession.headers.get("content-type") ?? "";
    await drain(noSession);
    assertEquals(noSessionOk, false);
    assert(!noSessionType.startsWith("text/event-stream"), noSessionType);

    const sid = await login(port);
    const empty = await fetch(`http://localhost:${port}/agents/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ content: "" }),
    });
    const emptyOk = empty.ok;
    const emptyType = empty.headers.get("content-type") ?? "";
    await drain(empty);
    assertEquals(emptyOk, false);
    assert(!emptyType.startsWith("text/event-stream"), emptyType);
  });
});
