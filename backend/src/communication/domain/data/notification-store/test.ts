import { assertEquals, assertRejects } from "#std/assert";
import { NotificationStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { ForbiddenError } from "@core/data/repository/mod.ts";

Deno.test("notification-store smoke: create + get returns the notification", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new NotificationStore();
  const n = await store.create({ userId: "u-1", type: "quote_sent", title: "Quote sent to Acme" });
  const fetched = await store.get(n.id);
  assertEquals(fetched.title, "Quote sent to Acme");
  assertEquals(fetched.read, false);
  await resetKv();
});

Deno.test("notification-store smoke: listByUser returns newest-first", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new NotificationStore();
  const a = await store.create({ userId: "u-1", type: "quote_sent", title: "A" });
  await new Promise((r) => setTimeout(r, 5));
  const b = await store.create({ userId: "u-1", type: "quote_sent", title: "B" });
  const list = await store.listByUser("u-1");
  assertEquals(list[0].id, b.id);
  assertEquals(list[1].id, a.id);
  await resetKv();
});

Deno.test("notification-store smoke: listByUser is per-user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new NotificationStore();
  await store.create({ userId: "u-1", type: "quote_sent", title: "u1" });
  await store.create({ userId: "u-2", type: "quote_sent", title: "u2" });
  assertEquals((await store.listByUser("u-1")).length, 1);
  assertEquals((await store.listByUser("u-2")).length, 1);
  await resetKv();
});

Deno.test("notification-store smoke: unreadCount + markRead toggle work", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new NotificationStore();
  const a = await store.create({ userId: "u-1", type: "quote_sent", title: "A" });
  await store.create({ userId: "u-1", type: "quote_sent", title: "B" });
  assertEquals(await store.unreadCount("u-1"), 2);

  const after = await store.markRead(a.id, "u-1");
  assertEquals(after.read, true);
  assertEquals(typeof after.readAt, "string");
  assertEquals(await store.unreadCount("u-1"), 1);
  await resetKv();
});

Deno.test("notification-store smoke: markRead is idempotent", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new NotificationStore();
  const a = await store.create({ userId: "u-1", type: "quote_sent", title: "A" });
  const r1 = await store.markRead(a.id, "u-1");
  const r2 = await store.markRead(a.id, "u-1");
  assertEquals(r1.readAt, r2.readAt);                     // didn't change
  await resetKv();
});

Deno.test("notification-store smoke: markAllRead clears unread count", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new NotificationStore();
  await store.create({ userId: "u-1", type: "quote_sent", title: "A" });
  await store.create({ userId: "u-1", type: "quote_sent", title: "B" });
  await store.create({ userId: "u-1", type: "quote_sent", title: "C" });
  const result = await store.markAllRead("u-1");
  assertEquals(result.count, 3);
  assertEquals(await store.unreadCount("u-1"), 0);
  await resetKv();
});

Deno.test("notification-store smoke: cross-user markRead is forbidden", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new NotificationStore();
  const a = await store.create({ userId: "u-1", type: "quote_sent", title: "A" });
  await assertRejects(() => store.markRead(a.id, "u-2"), ForbiddenError);
  await resetKv();
});

Deno.test("notification-store smoke: listByUser limit caps results", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new NotificationStore();
  for (let i = 0; i < 5; i++) {
    await store.create({ userId: "u-1", type: "quote_sent", title: `n${i}` });
    await new Promise((r) => setTimeout(r, 2));
  }
  const limited = await store.listByUser("u-1", { limit: 2 });
  assertEquals(limited.length, 2);
  await resetKv();
});

Deno.test("notification-store smoke: unreadOnly filters out read notifications", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new NotificationStore();
  const a = await store.create({ userId: "u-1", type: "quote_sent", title: "A" });
  await store.create({ userId: "u-1", type: "quote_sent", title: "B" });
  await store.markRead(a.id, "u-1");
  const unread = await store.listByUser("u-1", { unreadOnly: true });
  assertEquals(unread.length, 1);
  assertEquals(unread[0].title, "B");
  await resetKv();
});
