/**
 * REQ-236 (demo M8) — end to end over HTTP on the booted app: a send that
 * reaches nobody is NOT a sent quote anywhere the contractor looks, and a
 * good resend makes it one.
 *
 *   POST /agents/conversations/:id/send-quote (customer has no phone, SMS)
 *     → GET /quotes            stage "undelivered" (not "sent"/"Just sent")
 *     → GET /quotes/:id        lastDelivery carries the failure, no deliveredAt
 *     → GET /agents/conversations   quoteStatus "undelivered" (list chip)
 *   add an email, resend by email
 *     → stage "sent", quoteStatus "sent", deliveredAt stamped
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
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

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

const PORT = 9236;
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

async function login(phone = "+15125551234"): Promise<string> {
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

Deno.test("REQ-236 e2e: a failed send reads undelivered on /quotes and the thread list; a good resend reads sent", async () => {
  await withServer(async () => {
    const sid = await login();
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const post = (path: string, body: unknown) =>
      fetch(`${BASE}${path}`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
      }).then((r) => r.json());
    const get = (path: string) =>
      fetch(`${BASE}${path}`, { headers: { "x-session-id": sid } }).then((
        r,
      ) => r.json());

    // A customer with no phone and no email.
    const customer = await post("/customers", { name: "Maria Lopez" });
    const quote = await post("/quotes", {
      summary: "Fence repair",
      lineItems: [],
      estimatedTotal: 35_000,
      customerId: customer.id,
    });
    // The paperwork senders refuse an unnamed contractor — name the account.
    const kv = await getKv();
    const userKey = ["user", quote.userId];
    const user = (await kv.get<Record<string, unknown>>(userKey)).value!;
    await kv.set(userKey, { ...user, name: "Test Contractor" });

    const conv = await post("/agents/conversations", {});
    await new AgentConversationStore().update(conv.id, {
      quoteId: quote.id,
      customerId: customer.id,
    });

    // 1) Text it — there is no phone on file, so it reaches nobody.
    const r1 = await post(`/agents/conversations/${conv.id}/send-quote`, {
      quoteId: quote.id,
      channel: "sms",
    });
    assertEquals(r1.conversation.quoteStatus, "undelivered");
    const div1 = r1.newMessages[0].payload;
    assertEquals(div1.textedTo, undefined);
    assert(div1.smsFailureReason, "the divider names the failure");

    let cards = await get("/quotes");
    assertEquals(cards[0].stage, "undelivered", "/quotes: not 'Just sent'");
    const q1 = await get(`/quotes/${quote.id}`);
    assertEquals(q1.deliveredAt, undefined);
    assertEquals(q1.lastDelivery.channel, "sms");
    assert(q1.lastDelivery.smsFailureReason);
    let threads = await get("/agents/conversations");
    assertEquals(
      threads.find((c: { id: string }) => c.id === conv.id).quoteStatus,
      "undelivered",
    );

    // 2) Add an email and resend by email — now it is sent. (SMS can't
    //    deliver in a test process: no Twilio sender.)
    await fetch(`${BASE}/customers/${customer.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ email: "maria@example.com" }),
    }).then((r) => r.body?.cancel());
    const r2 = await post(`/agents/conversations/${conv.id}/send-quote`, {
      quoteId: quote.id,
      channel: "email",
    });
    assertEquals(
      r2.newMessages[0].payload.emailedTo,
      "maria@example.com",
      "resend delivered",
    );
    assertEquals(r2.conversation.quoteStatus, "sent");
    cards = await get("/quotes");
    assertEquals(cards[0].stage, "sent");
    const q2 = await get(`/quotes/${quote.id}`);
    assert(q2.deliveredAt, "deliveredAt stamped on the good resend");
    threads = await get("/agents/conversations");
    assertEquals(
      threads.find((c: { id: string }) => c.id === conv.id).quoteStatus,
      "sent",
    );
  });
});

// REQ-525 (demo-loop cycle 3, p8-pair2-a): over HTTP, a text to a fictional
// 555 number answers with a divider whose label is the short "Text not
// delivered" — the reason rides on the payload for the send card, the one
// place that shows it — never "… text failed — <reason>".
Deno.test("REQ-525 e2e: a failed text's divider label does not restate the reason the send card shows", async () => {
  await withServer(async () => {
    const sid = await login("+15125551299");
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const post = (path: string, body: unknown) =>
      fetch(`${BASE}${path}`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
      }).then((r) => r.json());
    const customer = await post("/customers", {
      name: "Dana Fictional",
      phoneNumber: "+15125550123",
    });
    const quote = await post("/quotes", {
      summary: "Fence repair",
      lineItems: [],
      estimatedTotal: 35_000,
      customerId: customer.id,
    });
    const kv = await getKv();
    const userKey = ["user", quote.userId];
    const user = (await kv.get<Record<string, unknown>>(userKey)).value!;
    await kv.set(userKey, { ...user, name: "Test Contractor", language: "en" });
    const conv = await post("/agents/conversations", {});
    await new AgentConversationStore().update(conv.id, {
      quoteId: quote.id,
      customerId: customer.id,
    });

    const r = await post(`/agents/conversations/${conv.id}/send-quote`, {
      quoteId: quote.id,
      channel: "sms",
    });
    const div = r.newMessages[0];
    assertEquals(div.payload.smsFailureCode, "fictional");
    assert(div.payload.smsFailureReason, "the payload carries the reason");
    assertEquals(div.content, "Text not delivered");
    assertEquals(div.payload.label, "Text not delivered");
  });
});
