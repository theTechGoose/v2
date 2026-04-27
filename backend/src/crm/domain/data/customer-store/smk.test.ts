import { assertEquals, assertRejects } from "#std/assert";
import { CustomerStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";

Deno.test("customer-store smoke: create then get returns the same customer", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new CustomerStore();
  const created = await store.create("u-1", { name: "Acme" });
  const fetched = await store.get(created.id);
  assertEquals(fetched.name, "Acme");
  assertEquals(fetched.userId, "u-1");
  await resetKv();
});

Deno.test("customer-store smoke: getOwned returns the customer for the rightful owner", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new CustomerStore();
  const created = await store.create("u-1", { name: "Acme" });
  const got = await store.getOwned(created.id, "u-1");
  assertEquals(got.id, created.id);
  await resetKv();
});

Deno.test("customer-store smoke: getOwned throws ForbiddenError for cross-user access", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new CustomerStore();
  const created = await store.create("u-1", { name: "Acme" });
  await assertRejects(() => store.getOwned(created.id, "u-2"), ForbiddenError);
  await resetKv();
});

Deno.test("customer-store smoke: getOwned throws NotFoundError for missing id", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new CustomerStore();
  await assertRejects(() => store.getOwned("nope", "u-1"), NotFoundError);
  await resetKv();
});

Deno.test("customer-store smoke: listByUser scopes by user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new CustomerStore();
  await store.create("u-1", { name: "Acme" });
  await store.create("u-1", { name: "Beta" });
  await store.create("u-2", { name: "Gamma" });
  const a = await store.listByUser("u-1");
  const b = await store.listByUser("u-2");
  assertEquals(a.length, 2);
  assertEquals(b.length, 1);
  assertEquals(b[0].name, "Gamma");
  await resetKv();
});

Deno.test("customer-store smoke: update enforces ownership", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new CustomerStore();
  const created = await store.create("u-1", { name: "Acme" });
  await assertRejects(() => store.update(created.id, "u-2", { name: "hacked" }), ForbiddenError);
  await resetKv();
});

Deno.test("customer-store smoke: update merges + bumps updatedAt for owner", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new CustomerStore();
  const created = await store.create("u-1", { name: "Acme", email: "a@a.test" });
  await new Promise((r) => setTimeout(r, 10));
  const updated = await store.update(created.id, "u-1", { phoneNumber: "555-1234" });
  assertEquals(updated.name, "Acme");                         // preserved
  assertEquals(updated.email, "a@a.test");                    // preserved
  assertEquals(updated.phoneNumber, "555-1234");              // added
  if (updated.updatedAt <= created.updatedAt) {
    throw new Error("updatedAt should advance");
  }
  await resetKv();
});

Deno.test("customer-store smoke: delete enforces ownership", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new CustomerStore();
  const created = await store.create("u-1", { name: "Acme" });
  await assertRejects(() => store.delete(created.id, "u-2"), ForbiddenError);
  await resetKv();
});

Deno.test("customer-store smoke: delete removes record + index", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new CustomerStore();
  const created = await store.create("u-1", { name: "Acme" });
  await store.delete(created.id, "u-1");
  await assertRejects(() => store.get(created.id), NotFoundError);
  assertEquals((await store.listByUser("u-1")).length, 0);
  await resetKv();
});
