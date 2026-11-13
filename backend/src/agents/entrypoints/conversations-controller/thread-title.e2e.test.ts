/**
 * REQ-447 (demo-loop cycle 3, demo issues p8-pair10-d + m14) — on the booted
 * app, over HTTP: a thread has ONE title, and the chat header
 * (`deriveChatHeader` over GET /agents/conversations/:id, what AsstChat and
 * the /assistant/[id] route render) reads what the conversation list
 * (GET /agents/conversations → `threadTitle`, what AsstThreads renders) reads.
 *
 *   - after a first message and no quote, the header said "New conversation"
 *     while the list was titled by that message (fleet-9 l.76);
 *   - once a quote exists, its jobName is the thread's stored title too — the
 *     conversation is bound to the quote by POST /agents/conversations
 *     { quoteId } or POST /agents/conversations/:id/draft { quoteId }.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { deriveChatHeader } from "#quote-flow/chat-header.ts";
import { threadTitle } from "#quote-flow/thread-title.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9447;
const BASE = `http://localhost:${PORT}`;
const J = { "content-type": "application/json" };

async function withServer(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn();
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(phone = "+15125550447"): Promise<string> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

function client(sid: string) {
  const auth = { ...J, "x-session-id": sid };
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => undefined);
    assert(res.ok, `${path} answered ${res.status}: ${JSON.stringify(json)}`);
    return json;
  };
  const get = (path: string) =>
    fetch(`${BASE}${path}`, { headers: { "x-session-id": sid } }).then((r) =>
      r.json()
    );
  /** The header's literal title, exactly as AsstChat derives it from the
   *  thread's detail; undefined = the "New conversation" key. */
  const headerOf = async (id: string) => {
    const d = await get(`/agents/conversations/${id}`);
    return deriveChatHeader({
      customerName: d.customer?.name,
      title: d.conversation?.title,
      quote: d.quote,
      messages: d.messages ?? [],
    });
  };
  const rowOf = async (id: string) => {
    const rows = await get(`/agents/conversations?limit=50`) as {
      id: string;
      jobName?: string;
      customerName?: string;
      title?: string;
    }[];
    return rows.find((r) => r.id === id)!;
  };
  return { post, get, headerOf, rowOf };
}

const quoteBody = {
  summary: "Replacement of kitchen sink faucet",
  jobName: "Faucet Replacement",
  lineItems: [{
    description: "Replace kitchen sink faucet",
    quantity: 1,
    unit: "ea",
    price: 18_000,
  }],
  estimatedTotal: 18_000,
  status: "draft",
};

Deno.test("REQ-447 e2e (p8-pair10-d): after the first message, with no quote, the chat header names the thread exactly as the list does — never 'New conversation'", async () => {
  await withServer(async () => {
    const c = client(await login());
    const turn = await c.post("/agents/chat", {
      content: "Need a price on a cedar fence for the Ruiz family",
    });
    const id = turn.conversation.id as string;
    assertEquals(
      turn.conversation.title,
      "Need a price on a cedar fence for the Ruiz family",
    );
    const row = await c.rowOf(id);
    const listed = threadTitle(row, "en");
    assert(!/new conversation/i.test(listed), `list row: ${listed}`);
    const header = await c.headerOf(id);
    assertEquals(header.clientName, listed);
  });
});

Deno.test("REQ-447 e2e (m14): a conversation started on a quote is titled by its jobName", async () => {
  await withServer(async () => {
    const c = client(await login("+15125550448"));
    const quote = await c.post("/quotes", quoteBody);
    const conv = await c.post("/agents/conversations", { quoteId: quote.id });
    assertEquals(conv.title, "Faucet Replacement");
    const row = await c.rowOf(conv.id);
    assertEquals(row.title, "Faucet Replacement");
    assertEquals(threadTitle(row, "en"), "Faucet Replacement");
    assertEquals((await c.headerOf(conv.id)).clientName, "Faucet Replacement");
  });
});

Deno.test("REQ-447 e2e (m14): binding a quote to a titled thread (POST :id/draft { quoteId }) retitles it by the jobName, not the first message", async () => {
  await withServer(async () => {
    const c = client(await login("+15125550449"));
    const turn = await c.post("/agents/chat", {
      content: "cambiar la llave del fregadero de la cocina, $180",
    });
    const id = turn.conversation.id as string;
    const quote = await c.post("/quotes", quoteBody);
    const bound = await c.post(`/agents/conversations/${id}/draft`, {
      quoteId: quote.id,
    });
    assertEquals(bound.title, "Faucet Replacement");
    const detail = await c.get(`/agents/conversations/${id}`);
    assertEquals(detail.conversation.title, "Faucet Replacement");
    assertEquals((await c.headerOf(id)).clientName, "Faucet Replacement");
  });
});

/**
 * REQ-580 (demo-loop cycle 4, issue p4-p7b): the details-first flows mint a
 * thread and park the typed job details on it with POST :id/draft { note }.
 * That note is the thread's first message, so it titles the thread and is
 * its preview — the list must never show "New conversation —" while the
 * contractor picks options. A later note does not retitle it, and a quote's
 * jobName title (REQ-447) is never overwritten by a note.
 */
const NOTE = "Kitchen remodel for Karen Henderson: new cabinets";

Deno.test("REQ-580 e2e (p4-p7b): the first draft note titles the minted thread and is its preview — never 'New conversation —'", async () => {
  await withServer(async () => {
    const c = client(await login("+15125550580"));
    const conv = await c.post("/agents/conversations", {});
    const saved = await c.post(`/agents/conversations/${conv.id}/draft`, {
      note: NOTE,
    });
    assertEquals(saved.title, NOTE);
    assertEquals(saved.preview, NOTE);
    const row = await c.rowOf(conv.id) as { title?: string; preview?: string };
    assertEquals(row.title, NOTE);
    assertEquals(row.preview, NOTE);
    assertEquals(threadTitle(row, "en"), NOTE);
    assertEquals((await c.headerOf(conv.id)).clientName, NOTE);
  });
});

Deno.test("REQ-580 e2e (p4-p7b): a second draft note does not retitle the thread", async () => {
  await withServer(async () => {
    const c = client(await login("+15125550581"));
    const conv = await c.post("/agents/conversations", {});
    await c.post(`/agents/conversations/${conv.id}/draft`, { note: NOTE });
    const again = await c.post(`/agents/conversations/${conv.id}/draft`, {
      note: "actually make it a bathroom",
    });
    assertEquals(again.title, NOTE);
    assertEquals((await c.rowOf(conv.id) as { title?: string }).title, NOTE);
  });
});

Deno.test("REQ-580 e2e (p4-p7b): a note on a quote-bound thread keeps the jobName title", async () => {
  await withServer(async () => {
    const c = client(await login("+15125550582"));
    const quote = await c.post("/quotes", quoteBody);
    const conv = await c.post("/agents/conversations", { quoteId: quote.id });
    const saved = await c.post(`/agents/conversations/${conv.id}/draft`, {
      note: NOTE,
    });
    assertEquals(saved.title, "Faucet Replacement");
  });
});
