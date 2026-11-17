import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

// REQ-485 (demo-loop cycle 3, issue m22): DELETE /quotes/:id refuses a
// signed quote (409 locked_accepted) and a quote billed by a live invoice
// (409 locked_invoiced). Before, it soft-deleted any quote after one confirm().

@Module({ imports: [UsersModule, CrmModule, PaperworkModule] })
class TestApp {}

const PORT = 41000 + Math.floor(Math.random() * 2000);

async function login(port: number, phone = "+15125557485"): Promise<string> {
  await (await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function withServer(fn: (sid: string, userId: string) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const session = await new SessionStore().get(sid);
    await fn(sid, session!.userId);
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function del(sid: string, id: string) {
  const res = await fetch(`http://localhost:${PORT}/quotes/${id}`, {
    method: "DELETE",
    headers: { "x-session-id": sid },
  });
  return { status: res.status, body: await res.json() };
}

Deno.test("REQ-485 m22 DELETE /quotes/:id on a signed quote → 409 locked_accepted and it stays", async () => {
  await withServer(async (sid, userId) => {
    const quotes = new QuoteStore();
    const q = await quotes.create(userId, { summary: "Fence", lineItems: [] });
    await quotes.update(q.id, userId, {
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    });
    const res = await del(sid, q.id);
    assertEquals(res.status, 409);
    assertEquals(res.body.reason, "locked_accepted");
    assertEquals((await quotes.getOwned(q.id, userId)).deletedAt, undefined);
  });
});

Deno.test("REQ-485 m22 DELETE /quotes/:id on a quote with a live invoice → 409 locked_invoiced", async () => {
  await withServer(async (sid, userId) => {
    const quotes = new QuoteStore();
    const q = await quotes.create(userId, { summary: "Deck", lineItems: [] });
    await new InvoiceStore().create(userId, {
      quoteId: q.id,
      lineItems: [],
      status: "draft",
    } as never);
    const res = await del(sid, q.id);
    assertEquals(res.status, 409);
    assertEquals(res.body.reason, "locked_invoiced");
  });
});

Deno.test("REQ-485 m22 DELETE /quotes/:id on a draft (only void invoices) still deletes", async () => {
  await withServer(async (sid, userId) => {
    const quotes = new QuoteStore();
    const q = await quotes.create(userId, { summary: "Paint", lineItems: [] });
    await new InvoiceStore().create(userId, {
      quoteId: q.id,
      lineItems: [],
      status: "void",
    } as never);
    const res = await del(sid, q.id);
    assertEquals(res.status, 200);
    assertEquals(res.body.ok, true);
  });
});
