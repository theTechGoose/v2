import { assertEquals, assertRejects } from "#std/assert";
import { InvoiceStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { ForbiddenError } from "@core/data/repository/mod.ts";

Deno.test("invoice-store smoke: create + getOwned for owner", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new InvoiceStore();
  const i = await store.create("u-1", { contractId: "c-1", dueDate: "2026-05-01" });
  const fetched = await store.getOwned(i.id, "u-1");
  assertEquals(fetched.contractId, "c-1");
  await resetKv();
});

Deno.test("invoice-store smoke: cross-user denied", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new InvoiceStore();
  const i = await store.create("u-1", { contractId: "c-1", dueDate: "2026-05-01" });
  await assertRejects(() => store.getOwned(i.id, "u-2"), ForbiddenError);
  await resetKv();
});

Deno.test("invoice-store smoke: listByUserAndStatus ('pending' / 'paid')", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new InvoiceStore();
  await store.create("u-1", { contractId: "c-1", dueDate: "2026-05-01", status: "pending" });
  await store.create("u-1", { contractId: "c-1", dueDate: "2026-05-02", status: "paid" });
  await store.create("u-2", { contractId: "c-1", dueDate: "2026-05-03", status: "pending" });
  assertEquals((await store.listByUserAndStatus("u-1", "pending")).length, 1);
  assertEquals((await store.listByUserAndStatus("u-1", "paid")).length, 1);
  assertEquals((await store.listByUserAndStatus("u-2", "pending")).length, 1);
  await resetKv();
});
