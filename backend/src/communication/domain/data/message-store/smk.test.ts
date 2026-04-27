import { assertEquals } from "#std/assert";
import { MessageStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("message-store smoke: create and filter by conversation", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new MessageStore();
  const a = await store.create({ conversationId: "c1", role: "user", channel: "web", content: "hi" });
  await store.create({ conversationId: "c2", role: "user", channel: "email", content: "other" });
  const filtered = await store.listByConversation("c1");
  assertEquals(filtered.length, 1);
  assertEquals(filtered[0].id, a.id);
  await resetKv();
});

Deno.test("message-store smoke: listByConversation returns oldest-first", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new MessageStore();
  const first = await store.create({ conversationId: "c1", role: "user", channel: "web", content: "1" });
  await new Promise((r) => setTimeout(r, 5));
  const second = await store.create({ conversationId: "c1", role: "assistant", channel: "web", content: "2" });
  const list = await store.listByConversation("c1");
  assertEquals(list[0].id, first.id);
  assertEquals(list[1].id, second.id);
  await resetKv();
});

Deno.test("message-store smoke: delete removes from both record and index", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new MessageStore();
  const a = await store.create({ conversationId: "c1", role: "user", channel: "web", content: "x" });
  await store.delete(a.id);
  assertEquals((await store.listByConversation("c1")).length, 0);
  await resetKv();
});
