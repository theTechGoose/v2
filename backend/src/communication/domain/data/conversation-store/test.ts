import { assertEquals, assertRejects } from "#std/assert";
import { ConversationStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { ForbiddenError } from "@core/data/repository/mod.ts";

Deno.test("conversation-store smoke: create + getOwned", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ConversationStore();
  const c = await store.create("u-1", { title: "kickoff" });
  const fetched = await store.getOwned(c.id, "u-1");
  assertEquals(fetched.title, "kickoff");
  await resetKv();
});

Deno.test("conversation-store smoke: cross-user denied", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ConversationStore();
  const c = await store.create("u-1", { title: "kickoff" });
  await assertRejects(() => store.getOwned(c.id, "u-2"), ForbiddenError);
  await resetKv();
});

Deno.test("conversation-store smoke: listByUser scopes correctly", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ConversationStore();
  await store.create("u-1", { title: "u1-a" });
  await store.create("u-1", { title: "u1-b" });
  await store.create("u-2", { title: "u2-a" });
  assertEquals((await store.listByUser("u-1")).length, 2);
  assertEquals((await store.listByUser("u-2")).length, 1);
  await resetKv();
});
