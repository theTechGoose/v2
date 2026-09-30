import { assertEquals, assertRejects } from "#std/assert";
import { AccountStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { ForbiddenError } from "@core/data/repository/mod.ts";

Deno.test("account-store smoke: create + get for owner", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AccountStore();
  const a = await store.create("u-1", { name: "Acme — ledger", customerId: "cust-1" });
  const fetched = await store.getOwned(a.id, "u-1");
  assertEquals(fetched.customerId, "cust-1");
  assertEquals(fetched.userId, "u-1");
  await resetKv();
});

Deno.test("account-store smoke: listByCustomer is user-scoped", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AccountStore();
  await store.create("u-1", { name: "U1 acct A", customerId: "cust-1" });
  await store.create("u-1", { name: "U1 acct B", customerId: "cust-2" });
  await store.create("u-2", { name: "U2 acct A", customerId: "cust-1" });

  assertEquals((await store.listByCustomer("u-1", "cust-1")).length, 1);
  assertEquals((await store.listByCustomer("u-2", "cust-1")).length, 1);
  assertEquals((await store.listByCustomer("u-1", "cust-2")).length, 1);
  await resetKv();
});

Deno.test("account-store smoke: cross-user getOwned/update/delete are rejected", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new AccountStore();
  const a = await store.create("u-1", { name: "U1 acct" });
  await assertRejects(() => store.getOwned(a.id, "u-2"), ForbiddenError);
  await assertRejects(() => store.update(a.id, "u-2", { name: "hacked" }), ForbiddenError);
  await assertRejects(() => store.delete(a.id, "u-2"), ForbiddenError);
  await resetKv();
});
