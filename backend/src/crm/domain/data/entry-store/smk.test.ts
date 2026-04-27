import { assertEquals, assertRejects } from "#std/assert";
import { EntryStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { ForbiddenError } from "@core/data/repository/mod.ts";

Deno.test("entry-store smoke: filter by account and by transaction (per user)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new EntryStore();
  await store.create("u-1", { accountId: "cash", amount: 1000, occurredAt: "2026-04-26", transactionId: "t1" });
  await store.create("u-1", { accountId: "ar",   amount: -1000, occurredAt: "2026-04-26", transactionId: "t1" });
  await store.create("u-1", { accountId: "cash", amount: -50, occurredAt: "2026-04-27" });

  assertEquals((await store.listByAccount("u-1", "cash")).length, 2);
  assertEquals((await store.listByTransaction("u-1", "t1")).length, 2);
  await resetKv();
});

Deno.test("entry-store smoke: filters are user-scoped", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new EntryStore();
  await store.create("u-1", { accountId: "cash", amount: 100, occurredAt: "2026-04-26", transactionId: "t1" });
  await store.create("u-2", { accountId: "cash", amount: 200, occurredAt: "2026-04-26", transactionId: "t1" });

  assertEquals((await store.listByAccount("u-1", "cash")).length, 1);
  assertEquals((await store.listByAccount("u-2", "cash")).length, 1);
  assertEquals((await store.listByTransaction("u-1", "t1"))[0].amount, 100);
  assertEquals((await store.listByTransaction("u-2", "t1"))[0].amount, 200);
  await resetKv();
});

Deno.test("entry-store smoke: cross-user getOwned/update/delete throw", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new EntryStore();
  const e = await store.create("u-1", { accountId: "cash", amount: 100, occurredAt: "2026-04-26" });
  await assertRejects(() => store.getOwned(e.id, "u-2"), ForbiddenError);
  await assertRejects(() => store.update(e.id, "u-2", { amount: 999 }), ForbiddenError);
  await assertRejects(() => store.delete(e.id, "u-2"), ForbiddenError);
  await resetKv();
});
