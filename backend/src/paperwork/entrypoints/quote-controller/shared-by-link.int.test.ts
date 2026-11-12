/**
 * REQ-572 (demo-loop cycle 4, issue p4-p7c): "'Copy link' leaves quote
 * 'Ready to send'". The owner who copied the link and shared it themselves
 * marks the quote sent: PUT /quotes/:id {status:"sent", sentVia:"link"}.
 * The backend stores sentVia "link" (and refuses any other value), stamps
 * sentAt, and a quote marked this way is never "undelivered" on /quotes.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule] })
class TestApp {}

const PORT = 9572;
const BASE = `http://localhost:${PORT}`;

async function drain(res: Response) {
  await res.body?.cancel();
}

async function login(phone = "+15125557572"): Promise<string> {
  await drain(
    await fetch(`${BASE}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
    }),
  );
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function withServer(
  fn: (auth: Record<string, string>) => Promise<void>,
) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    await fn({ "content-type": "application/json", "x-session-id": sid });
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function createDraft(auth: Record<string, string>) {
  return await fetch(`${BASE}/quotes`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      summary: "Gate repair",
      jobName: "Gate repair",
      lineItems: [{
        description: "Gate repair",
        quantity: 1,
        unit: "ea",
        price: 45000,
      }],
      estimatedTotal: 45000,
    }),
  }).then((r) => r.json());
}

Deno.test("REQ-572 p4-p7c PUT /quotes/:id {status:'sent', sentVia:'link'} marks it shared by link and stamps sentAt", async () => {
  await withServer(async (auth) => {
    const q = await createDraft(auth);
    assertEquals(q.status, "draft");
    const res = await fetch(`${BASE}/quotes/${q.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent", sentVia: "link" }),
    });
    assertEquals(res.status, 200);
    const updated = await res.json();
    assertEquals(updated.status, "sent");
    assertEquals(updated.sentVia, "link");
    assert(updated.sentAt, "the first issue stamps sentAt");
    const row = await fetch(`${BASE}/quotes/${q.id}`, { headers: auth })
      .then((r) => r.json());
    assertEquals(row.sentVia, "link", "sentVia is stored on the quote");
  });
});

Deno.test("REQ-572 p4-p7c a not-delivered quote the owner marks shared by link is stage 'sent' on /quotes, not 'undelivered'", async () => {
  await withServer(async (auth) => {
    const q = await createDraft(auth);
    // a send that reached nobody (SendQuote's stored outcome)
    await new QuoteStore().update(q.id, q.userId, {
      lastDelivery: {
        at: new Date().toISOString(),
        channel: "email",
        emailFailureReason: "no email on file",
      },
    });
    const before = await fetch(`${BASE}/quotes`, { headers: auth })
      .then((r) => r.json());
    assertEquals(
      before.find((c: { id: string }) => c.id === q.id)?.stage,
      "undelivered",
    );
    await drain(
      await fetch(`${BASE}/quotes/${q.id}`, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify({ status: "sent", sentVia: "link" }),
      }),
    );
    const after = await fetch(`${BASE}/quotes`, { headers: auth })
      .then((r) => r.json());
    assertEquals(
      after.find((c: { id: string }) => c.id === q.id)?.stage,
      "sent",
    );
  });
});

Deno.test("REQ-572 p4-p7c any sentVia other than 'link' is refused and stores nothing", async () => {
  await withServer(async (auth) => {
    const q = await createDraft(auth);
    const res = await fetch(`${BASE}/quotes/${q.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent", sentVia: "pigeon" }),
    });
    await drain(res);
    assert(!res.ok, `sentVia "pigeon" is refused (got ${res.status})`);
    const row = await fetch(`${BASE}/quotes/${q.id}`, { headers: auth })
      .then((r) => r.json());
    assertEquals(row.status, "draft");
    assertEquals(row.sentVia, undefined);
  });
});
