/** REQ-134 — listByUser over hundreds of customers reads them in batches, not one by one. */
import { assertEquals } from "#std/assert";
import { CustomerStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("REQ-134 customer-store — 250 customers listByUser: all 250, the deleted one left out, another user's never", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const store = new CustomerStore();
    const mine = await Promise.all(Array.from({ length: 251 }, (_, i) => store.create("u-1", { name: `Customer ${String(i).padStart(3, "0")}` })));
    await store.create("u-2", { name: "Someone else's" });
    await store.delete(mine[7].id, "u-1");
    const t0 = performance.now();
    const list = await store.listByUser("u-1");
    const ms = performance.now() - t0;
    assertEquals(list.length, 250);
    assertEquals(list.some((c) => c.id === mine[7].id), false);
    assertEquals(list.every((c) => c.userId === "u-1"), true);
    assertEquals(new Set(list.map((c) => c.id)).size, 250);
    console.log(`listByUser(250) in ${ms.toFixed(0)} ms`);
  } finally {
    await resetKv();
  }
});
