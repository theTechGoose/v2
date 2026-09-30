import { assertEquals } from "#std/assert";
import { ViewStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("view-store smoke: filter by paperwork type and id", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ViewStore();

  await store.create({ paperworkType: "quote", paperworkId: "q-1", viewedAt: "2026-04-26T10:00:00Z" });
  await store.create({ paperworkType: "quote", paperworkId: "q-1", viewedAt: "2026-04-26T11:00:00Z" });
  await store.create({ paperworkType: "invoice", paperworkId: "i-1", viewedAt: "2026-04-26T12:00:00Z" });

  const q1Views = await store.listByPaperwork("quote", "q-1");
  assertEquals(q1Views.length, 2);

  const allInvoices = await store.listByType("invoice");
  assertEquals(allInvoices.length, 1);

  await resetKv();
});
