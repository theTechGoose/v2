import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

/**
 * Cross-module e2e: a domain event raised by Paperwork (when a customer
 * accepts a quote on the public page) must fan out through the in-process
 * EventBus and end up as a row visible via GET /notifications. This proves
 * the EventBus singleton is shared across modules at the DI level.
 *
 * AgentsModule is mounted as a single root because it transitively imports
 * UsersModule, PaperworkModule, and CommunicationModule — that's the
 * production wiring, not a test-only shortcut.
 */
@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9094;

async function drain(res: Response) { await res.body?.cancel(); }

async function login(port: number, phone = "+15125551234"): Promise<string> {
  await drain(await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  }));
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function withServer(fn: (port: number) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try { await fn(PORT); } finally {
    await server.stop();
    await resetKv();
  }
}

Deno.test("cross-module e2e: customer accepts a quote → notification appears in /notifications", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    // Boot a notifications poll once so the NotifyOnEvent injectable is
    // eagerly constructed (it self-subscribes to the EventBus in its ctor).
    await drain(await fetch(`http://localhost:${port}/notifications`, { headers: { "x-session-id": sid } }));

    // Contractor creates a customer + quote.
    const customer = await fetch(`http://localhost:${port}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Acme Roofing" }),
    }).then((r) => r.json());
    const quote = await fetch(`http://localhost:${port}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({
        customerId: customer.id, summary: "Roof tear-off", lineItems: [], status: "sent", estimatedTotal: 12_500,
      }),
    }).then((r) => r.json());

    // Customer accepts via the public page (no session header — anonymous).
    const accept = await fetch(`http://localhost:${port}/quotes/${quote.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Tom & Linda K.", signature: "data:..." }),
    }).then((r) => r.json());
    assertEquals(accept.ok, true);

    // The contractor (who is logged in) should see a quote_accepted notification.
    const list = await fetch(`http://localhost:${port}/notifications`, { headers: { "x-session-id": sid } }).then((r) => r.json());
    assert(Array.isArray(list));
    const matching = list.filter((n: { type: string; entityId: string }) =>
      n.type === "quote_accepted" && n.entityId === quote.id
    );
    assertEquals(matching.length, 1);
    assertEquals(matching[0].title, "Acme Roofing accepted your quote");
  });
});

Deno.test("cross-module e2e: customer signs a contract → notification appears in /notifications", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    await drain(await fetch(`http://localhost:${port}/notifications`, { headers: { "x-session-id": sid } }));

    const customer = await fetch(`http://localhost:${port}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Beta Plumbing" }),
    }).then((r) => r.json());
    const quote = await fetch(`http://localhost:${port}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({
        customerId: customer.id, summary: "Repipe", lineItems: [], status: "accepted",
      }),
    }).then((r) => r.json());
    const contract = await fetch(`http://localhost:${port}/contracts`, {
      method: "POST", headers: auth, body: JSON.stringify({
        quoteId: quote.id, customerId: customer.id, totalAmount: 4_000,
      }),
    }).then((r) => r.json());

    const sign = await fetch(`http://localhost:${port}/contracts/${contract.id}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Beta Owner", signature: "data:..." }),
    }).then((r) => r.json());
    assertEquals(sign.ok, true);

    const list = await fetch(`http://localhost:${port}/notifications`, { headers: { "x-session-id": sid } }).then((r) => r.json());
    const matching = list.filter((n: { type: string; entityId: string }) =>
      n.type === "contract_signed" && n.entityId === contract.id
    );
    assertEquals(matching.length, 1);
    assertEquals(matching[0].title, "Beta Plumbing signed the contract");
  });
});

Deno.test("cross-module e2e: notification is scoped per-user — contractor B never sees A's events", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    const authA = { "content-type": "application/json", "x-session-id": sidA };

    // A's events fire.
    await drain(await fetch(`http://localhost:${port}/notifications`, { headers: { "x-session-id": sidA } }));
    await drain(await fetch(`http://localhost:${port}/notifications`, { headers: { "x-session-id": sidB } }));

    const customer = await fetch(`http://localhost:${port}/customers`, {
      method: "POST", headers: authA, body: JSON.stringify({ name: "A Co" }),
    }).then((r) => r.json());
    const quote = await fetch(`http://localhost:${port}/quotes`, {
      method: "POST", headers: authA, body: JSON.stringify({
        customerId: customer.id, summary: "x", lineItems: [], status: "sent",
      }),
    }).then((r) => r.json());
    await drain(await fetch(`http://localhost:${port}/quotes/${quote.id}/accept`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
    }));

    const aList = await fetch(`http://localhost:${port}/notifications`, { headers: { "x-session-id": sidA } }).then((r) => r.json());
    const bList = await fetch(`http://localhost:${port}/notifications`, { headers: { "x-session-id": sidB } }).then((r) => r.json());
    assertEquals(aList.filter((n: { type: string }) => n.type === "quote_accepted").length, 1);
    assertEquals(bList.filter((n: { type: string }) => n.type === "quote_accepted").length, 0);
  });
});
