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

// REQ-1088 (LOOP-007 cycle 3, q3-5/q3-6): QA5 created María José Peña through
// POST /api/customers with lowercase parts; the store composed and kept
// "45 palmetto dr, conway, SC 29526", which the invoice bill-to, /i and the
// email then printed raw — and a quote's address copied from the record.
Deno.test("REQ-1088 q3-6 customer-store — create with lowercase address parts stores a tidy address", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const store = new CustomerStore();
    const c = await store.create("u-1", {
      name: "María José Peña",
      street: "45 palmetto dr",
      city: "conway",
      state: "SC",
      zip: "29526",
    });
    assertEquals(
      (await store.getOwned(c.id, "u-1")).address,
      "45 Palmetto Dr, Conway, SC 29526",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1088 q3-5 customer-store — update with a lowercase free-text address stores it tidy", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const store = new CustomerStore();
    const c = await store.create("u-1", { name: "María José Peña" });
    await store.update(c.id, "u-1", {
      address: "12 oak st, myrtle beach, sc 29577",
    });
    assertEquals(
      (await store.getOwned(c.id, "u-1")).address,
      "12 Oak St, Myrtle Beach, SC 29577",
    );
  } finally {
    await resetKv();
  }
});
