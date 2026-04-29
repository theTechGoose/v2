import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CommunicationModule } from "@communication/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { NotificationStore } from "@communication/domain/data/notification-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CommunicationModule] })
class TestApp {}

// Cross-module suite: a real Paperwork event must reach Notifications via
// the in-process EventBus singleton. AgentsModule transitively imports
// Users + Paperwork + Communication — that's the production wiring.
@Module({ imports: [AgentsModule] })
class CrossModuleApp {}

const PORT = 9080;

async function drain(res: Response) { await res.body?.cancel(); }

async function login(port: number, phone = "+15125551234"): Promise<{ sessionId: string; userId: string }> {
  await drain(await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  }));
  const stored = await new OtpStore().get(phone);
  return await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
}

Deno.test("notifications e2e: list returns user's notifications newest-first", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const session = await login(PORT);
    // Seed via the store directly (the notify-on-event coordinator covers the EventBus integration test).
    const store = new NotificationStore();
    await store.create({ userId: session.userId, type: "quote_sent", title: "First" });
    await new Promise((r) => setTimeout(r, 5));
    await store.create({ userId: session.userId, type: "quote_sent", title: "Second" });

    const list = await fetch(`http://localhost:${PORT}/notifications`, {
      headers: { "x-session-id": session.sessionId },
    }).then((r) => r.json());
    assertEquals(list.length, 2);
    assertEquals(list[0].title, "Second");                // newest-first
    assertEquals(list[1].title, "First");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("notifications e2e: GET /unread-count returns the bell number", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const session = await login(PORT);
    const store = new NotificationStore();
    await store.create({ userId: session.userId, type: "quote_sent", title: "A" });
    await store.create({ userId: session.userId, type: "quote_sent", title: "B" });
    const body = await fetch(`http://localhost:${PORT}/notifications/unread-count`, {
      headers: { "x-session-id": session.sessionId },
    }).then((r) => r.json());
    assertEquals(body, { count: 2 });
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("notifications e2e: read-all clears unread count", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const session = await login(PORT);
    const store = new NotificationStore();
    await store.create({ userId: session.userId, type: "quote_sent", title: "A" });
    await store.create({ userId: session.userId, type: "quote_sent", title: "B" });

    await drain(await fetch(`http://localhost:${PORT}/notifications/read-all`, {
      method: "POST",
      headers: { "x-session-id": session.sessionId },
    }));

    const after = await fetch(`http://localhost:${PORT}/notifications/unread-count`, {
      headers: { "x-session-id": session.sessionId },
    }).then((r) => r.json());
    assertEquals(after, { count: 0 });
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("notifications e2e: cross-user notifications invisible", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const a = await login(PORT, "+15125551234");
    const b = await login(PORT, "+15125559999");
    const store = new NotificationStore();
    await store.create({ userId: a.userId, type: "quote_sent", title: "A's" });

    const bList = await fetch(`http://localhost:${PORT}/notifications`, {
      headers: { "x-session-id": b.sessionId },
    }).then((r) => r.json());
    assertEquals(bList, []);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("notifications e2e: GET without session is rejected", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const res = await fetch(`http://localhost:${PORT}/notifications`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});

// ---------------- cross-module suite ----------------

const X_PORT = 9094;

async function loginXmod(port: number, phone = "+15125551234"): Promise<string> {
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

async function withCrossModuleServer(fn: (port: number) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(CrossModuleApp, { port: X_PORT, swagger: false });
  await server.listen();
  try { await fn(X_PORT); } finally {
    await server.stop();
    await resetKv();
  }
}

Deno.test("cross-module e2e: customer accepts a quote → notification appears in /notifications", async () => {
  await withCrossModuleServer(async (port) => {
    const sid = await loginXmod(port);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    await drain(await fetch(`http://localhost:${port}/notifications`, { headers: { "x-session-id": sid } }));

    const customer = await fetch(`http://localhost:${port}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Acme Roofing" }),
    }).then((r) => r.json());
    const quote = await fetch(`http://localhost:${port}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({
        customerId: customer.id, summary: "Roof tear-off", lineItems: [], status: "sent", estimatedTotal: 12_500,
      }),
    }).then((r) => r.json());

    const accept = await fetch(`http://localhost:${port}/quotes/${quote.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Tom & Linda K.", signature: "data:..." }),
    }).then((r) => r.json());
    assertEquals(accept.ok, true);

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
  await withCrossModuleServer(async (port) => {
    const sid = await loginXmod(port);
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
  await withCrossModuleServer(async (port) => {
    const sidA = await loginXmod(port, "+15125551234");
    const sidB = await loginXmod(port, "+15125559999");
    const authA = { "content-type": "application/json", "x-session-id": sidA };

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
