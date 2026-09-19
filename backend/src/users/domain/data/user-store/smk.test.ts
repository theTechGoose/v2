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

Deno.test("user-store smoke: markOnboarded stamps onboardedAt + skipped, round-trips through get/update", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new UserStore();
  const created = await store.create({ phoneNumber: "+15125551234" });
  assertEquals(created.onboardedAt, undefined);

  const marked = await store.markOnboarded(created.id, true);
  assertEquals(marked.onboardingSkipped, true);
  if (!marked.onboardedAt) throw new Error("onboardedAt should be set");

  // Round-trips through a plain get.
  const got = await store.get(created.id);
  assertEquals(got.onboardedAt, marked.onboardedAt);
  assertEquals(got.onboardingSkipped, true);

  // A subsequent unrelated update must PRESERVE the onboarding fields.
  const afterUpdate = await store.update(created.id, { name: "Diego R." });
  assertEquals(afterUpdate.name, "Diego R.");
  assertEquals(afterUpdate.onboardedAt, marked.onboardedAt);
  assertEquals(afterUpdate.onboardingSkipped, true);
  await resetKv();
});

Deno.test("user-store smoke: markOnboarded is idempotent — second call keeps the first timestamp", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new UserStore();
  const created = await store.create({ phoneNumber: "+15125551234" });
  const first = await store.markOnboarded(created.id, false);
  await new Promise((r) => setTimeout(r, 10));
  // Second call (even with a different `skipped`) is a no-op.
  const second = await store.markOnboarded(created.id, true);
  assertEquals(second.onboardedAt, first.onboardedAt);
  assertEquals(second.onboardingSkipped, false);
  await resetKv();
});

// REQ-039 (NW-52, p58): "do not delete data, flag it as 'deleted'. When
// someone signs up with the same phone number, offer to create a new account
// or recover the old one." So the phone index must SURVIVE a delete.
Deno.test("REQ-039 NW-52 user-store: delete flags deletedAt and keeps the record + phone index", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new UserStore();
  const created = await store.create({ phoneNumber: "+15125551234" });
  await store.delete(created.id);
  const kept = await store.get(created.id);
  assertEquals(typeof kept.deletedAt, "string");
  const byPhone = await store.findByPhone("+15125551234");
  assertEquals(byPhone?.id, created.id);
  assertEquals(typeof byPhone?.deletedAt, "string");
  await resetKv();
});

Deno.test("REQ-039 NW-52 user-store: archivePhone frees the number for a fresh account", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new UserStore();
  const old = await store.create({ phoneNumber: "+15125551234" });
  await store.delete(old.id);
  await store.archivePhone(old.id);
  assertEquals(await store.findByPhone("+15125551234"), null);
  const fresh = await store.create({ phoneNumber: "+15125551234" });
  assertEquals(fresh.phoneNumber, "+15125551234");
  assertEquals((await store.get(old.id)).phoneNumber.startsWith("+15125551234#archived"), true);
  await resetKv();
});
