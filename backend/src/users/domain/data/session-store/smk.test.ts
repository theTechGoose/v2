import { assertEquals } from "#std/assert";
import { SessionStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("session-store smoke: create then get returns session bound to user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new SessionStore();
  const session = await store.create("user-1");
  const fetched = await store.get(session.id);
  assertEquals(fetched?.userId, "user-1");
  assertEquals(fetched?.id, session.id);
  await resetKv();
});

Deno.test("session-store smoke: get on missing id returns null", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new SessionStore();
  assertEquals(await store.get("nope"), null);
  await resetKv();
});

Deno.test("session-store smoke: delete removes the session", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new SessionStore();
  const session = await store.create("user-1");
  await store.delete(session.id);
  assertEquals(await store.get(session.id), null);
  await resetKv();
});

Deno.test("session-store smoke: each create yields a fresh id", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new SessionStore();
  const a = await store.create("user-1");
  const b = await store.create("user-1");
  if (a.id === b.id) throw new Error("session ids should be unique");
  await resetKv();
});
