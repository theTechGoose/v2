/**
 * REQ-570 (demo-loop cycle 4, issue m41) — the /quotes open panel's Send ▾,
 * over HTTP on the booted app.
 *
 * The panel has a quote id and (usually) a customer id, never a thread id.
 * Its Send runs the front-end's own `sendFromQuotePanel` (the code the
 * QuoteSendDialog calls) against the real API: find the conversation bound
 * to the quote, or start one bound to the quote + customer, then POST
 * /agents/conversations/:id/send-quote — the same SendQuote the chat uses.
 * A second Send reuses that thread instead of starting another.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { sendFromQuotePanel } from "../../../../../front-end/lib/quote-panel-send.ts";

@Module({
  imports: [
    UsersModule,
    CrmModule,
    PaperworkModule,
    AnalyticsModule,
    AgentsModule,
  ],
})
class TestApp {}

const PORT = 9570;
const BASE = `http://localhost:${PORT}`;

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

async function login(phone = "+15125553570"): Promise<string> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("REQ-570 m41 e2e: the /quotes panel's Send starts the quote's thread, sends through SendQuote, and a second Send reuses that thread", async () => {
  await withServer(async () => {
    const sid = await login();
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const get = (p: string) =>
      fetch(`${BASE}${p}`, { headers: auth }).then((r) => r.json());
    const post = async (p: string, body: unknown) => {
      const r = await fetch(`${BASE}${p}`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (!r.ok) {
        throw new Error(`POST ${p} → ${r.status} ${JSON.stringify(json)}`);
      }
      return json;
    };

    const customer = await post("/customers", {
      name: "Bob Gray",
      email: "bob@example.com",
    });
    const quote = await post("/quotes", {
      summary: "Deck stain",
      jobName: "Deck stain",
      lineItems: [{
        description: "Deck stain",
        quantity: 1,
        unit: "ea",
        price: 42_000,
      }],
      estimatedTotal: 42_000,
      customerId: customer.id,
    });
    const kv = await getKv();
    const userKey = ["user", quote.userId];
    const user = (await kv.get<Record<string, unknown>>(userKey)).value!;
    await kv.set(userKey, { ...user, name: "Test Contractor" });

    const before = await get("/agents/conversations");
    assertEquals(
      (before as { quoteId?: string }[]).filter((c) => c.quoteId === quote.id)
        .length,
      0,
      "the quote was made outside the chat — no thread is bound to it",
    );

    const deps = {
      list: () => get("/agents/conversations?limit=200"),
      start: (b: Record<string, unknown>) => post("/agents/conversations", b),
      send: (
        convId: string,
        quoteId: string,
        channel: "email" | "sms" | "both",
        language?: "en" | "es",
        requestId?: string,
      ) =>
        post(`/agents/conversations/${convId}/send-quote`, {
          quoteId,
          channel,
          ...(language ? { language } : {}),
          ...(requestId ? { requestId } : {}),
        }),
    };

    const first = await sendFromQuotePanel({
      quoteId: quote.id,
      customerId: customer.id,
      channel: "email",
      requestId: "panel-1",
    }, deps);
    assert(first.delivered, "the panel's Send delivered the quote");
    assertEquals(first.outcome?.emailedTo, "bob@example.com");

    const after = (await get("/agents/conversations")) as {
      id: string;
      quoteId?: string;
      customerId?: string;
    }[];
    const bound = after.filter((c) => c.quoteId === quote.id);
    assertEquals(bound.length, 1, "one thread now carries the quote");
    assertEquals(bound[0].id, first.conversationId);
    assertEquals(bound[0].customerId, customer.id);

    const sentQuote = await get(`/quotes/${quote.id}`);
    assertEquals(
      sentQuote.status,
      "sent",
      "SendQuote flipped the quote to sent",
    );

    const second = await sendFromQuotePanel({
      quoteId: quote.id,
      customerId: customer.id,
      channel: "email",
      requestId: "panel-2",
    }, deps);
    assertEquals(
      second.conversationId,
      first.conversationId,
      "a re-send from the panel reuses the quote's thread",
    );
    assert(second.delivered);
    const final = (await get("/agents/conversations")) as {
      quoteId?: string;
    }[];
    assertEquals(final.filter((c) => c.quoteId === quote.id).length, 1);
  });
});
