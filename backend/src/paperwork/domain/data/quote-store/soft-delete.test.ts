import { assertEquals, assertRejects } from "#std/assert";
import { QuoteStore } from "./mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

// REQ-039 (NW-52, p58): "Delete scope: do not delete data, flag it as
// 'deleted'." A deleted quote keeps its row with `deletedAt`; the owner can
// still read it with includeDeleted; lists never show it.
Deno.test("REQ-039 NW-52 quote-store: delete flags deletedAt, lists exclude it, includeDeleted reads it", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new QuoteStore();
  const q = await store.create("u-1", { summary: "Roof", lineItems: [] });
  await store.delete(q.id, "u-1");
  await assertRejects(() => store.get(q.id), NotFoundError);
  await assertRejects(() => store.getOwned(q.id, "u-1"), NotFoundError);
  assertEquals((await store.listByUser("u-1")).length, 0);
  const kept = await store.get(q.id, { includeDeleted: true });
  assertEquals(typeof kept.deletedAt, "string");
  assertEquals(kept.summary, "Roof");
  await resetKv();
});
