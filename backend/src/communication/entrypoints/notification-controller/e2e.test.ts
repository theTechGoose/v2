import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CommunicationModule } from "@communication/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { NotificationStore } from "@communication/domain/data/notification-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CommunicationModule] })
class TestApp {}

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
