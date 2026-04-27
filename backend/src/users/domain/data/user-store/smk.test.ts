import { assertEquals, assertRejects } from "#std/assert";
import { UserStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";

Deno.test("user-store smoke: create then findByPhone returns the user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new UserStore();
  const created = await store.create({ phoneNumber: "+15125551234", language: "en" });
  const found = await store.findByPhone("+15125551234");
  assertEquals(found?.id, created.id);
  assertEquals(found?.language, "en");
  await resetKv();
});

Deno.test("user-store smoke: get by id returns the user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new UserStore();
  const created = await store.create({ phoneNumber: "+15125551234" });
  const got = await store.get(created.id);
  assertEquals(got.phoneNumber, "+15125551234");
  await resetKv();
});

Deno.test("user-store smoke: get on missing id throws NotFoundError", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new UserStore();
  await assertRejects(() => store.get("nope"), NotFoundError);
  await resetKv();
});

Deno.test("user-store smoke: findByPhone returns null for unknown phone", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new UserStore();
  const result = await store.findByPhone("+10000000000");
  assertEquals(result, null);
  await resetKv();
});

Deno.test("user-store smoke: create with duplicate phone throws", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new UserStore();
  await store.create({ phoneNumber: "+15125551234" });
  await assertRejects(() => store.create({ phoneNumber: "+15125551234" }));
  await resetKv();
});

Deno.test("user-store smoke: update merges name/email/language and bumps updatedAt", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new UserStore();
  const created = await store.create({ phoneNumber: "+15125551234" });
  // Force a new ISO second to confirm updatedAt advances.
  await new Promise((r) => setTimeout(r, 10));
  const updated = await store.update(created.id, { name: "Diego R.", language: "es" });
  assertEquals(updated.name, "Diego R.");
  assertEquals(updated.language, "es");
  assertEquals(updated.phoneNumber, "+15125551234");          // unchanged
  assertEquals(updated.createdAt, created.createdAt);          // unchanged
  if (updated.updatedAt <= created.updatedAt) {
    throw new Error(`updatedAt should advance: ${updated.updatedAt} <= ${created.updatedAt}`);
  }
  await resetKv();
});

Deno.test("user-store smoke: delete removes both record and phone index", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new UserStore();
  const created = await store.create({ phoneNumber: "+15125551234" });
  await store.delete(created.id);
  await assertRejects(() => store.get(created.id), NotFoundError);
  assertEquals(await store.findByPhone("+15125551234"), null);
  await resetKv();
});
