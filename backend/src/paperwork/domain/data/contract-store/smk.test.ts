import { assertEquals, assertRejects } from "#std/assert";
import { ContractStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { ForbiddenError } from "@core/data/repository/mod.ts";

Deno.test("contract-store smoke: create + getOwned", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ContractStore();
  const c = await store.create("u-1", { quoteId: "q-1" });
  const fetched = await store.getOwned(c.id, "u-1");
  assertEquals(fetched.quoteId, "q-1");
  await resetKv();
});

Deno.test("contract-store smoke: cross-user denied", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ContractStore();
  const c = await store.create("u-1", { quoteId: "q-1" });
  await assertRejects(() => store.getOwned(c.id, "u-2"), ForbiddenError);
  await resetKv();
});

Deno.test("contract-store smoke: listByUserAndStatus filters per-user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ContractStore();
  await store.create("u-1", { quoteId: "q-1", status: "draft" });
  await store.create("u-1", { quoteId: "q-2", status: "signed" });
  await store.create("u-2", { quoteId: "q-3", status: "signed" });
  assertEquals((await store.listByUserAndStatus("u-1", "signed")).length, 1);
  assertEquals((await store.listByUserAndStatus("u-2", "signed")).length, 1);
  await resetKv();
});
