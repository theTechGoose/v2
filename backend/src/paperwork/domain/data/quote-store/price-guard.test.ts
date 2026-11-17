/**
 * REQ-302 (demo-loop cycle 1, B1 + M29) — the store is the last gate on the
 * quote write path: no caller (the chat coordinator, the API, a wizard step)
 * can persist a negative line or a total at or below zero. Before this
 * `update` stored the patch verbatim and `create` spread the input as-is.
 */
import { assertEquals, assertRejects } from "#std/assert";
import { QuoteStore } from "./mod.ts";
import { QuotePriceError } from "#quote-flow/quote-price-guard.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("REQ-302 quote-store: create refuses a negative line and a zero total", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new QuoteStore();
  await assertRejects(
    () =>
      store.create("u-1", {
        summary: "Panel swap",
        lineItems: [{
          description: "Panel swap",
          quantity: 1,
          unit: "ea",
          price: -50_000,
        }],
        estimatedTotal: -50_000,
      }),
    QuotePriceError,
  );
  await assertRejects(
    () =>
      store.create("u-1", {
        summary: "Panel swap",
        lineItems: [{
          description: "Panel swap",
          quantity: 1,
          unit: "ea",
          price: 0,
        }],
        estimatedTotal: 0,
      }),
    QuotePriceError,
  );
  assertEquals((await store.listByUser("u-1")).length, 0);
  await resetKv();
});

Deno.test("REQ-302 quote-store: update refuses a negative line / zero total and keeps the row as it was", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new QuoteStore();
  const q = await store.create("u-1", {
    summary: "Panel swap",
    lineItems: [{
      description: "Panel swap",
      quantity: 1,
      unit: "ea",
      price: 50_000,
    }],
    estimatedTotal: 50_000,
  });
  await assertRejects(
    () =>
      store.update(q.id, "u-1", {
        lineItems: [{
          description: "Panel swap",
          quantity: 1,
          unit: "ea",
          price: -50_000,
        }],
        estimatedTotal: -50_000,
      }),
    QuotePriceError,
  );
  await assertRejects(
    () => store.update(q.id, "u-1", { estimatedTotal: 0 }),
    QuotePriceError,
  );
  const kept = await store.getOwned(q.id, "u-1");
  assertEquals(kept.estimatedTotal, 50_000);
  assertEquals(kept.lineItems[0].price, 50_000);
  // a patch that does not touch money (lock stamp) still goes through
  const locked = await store.update(q.id, "u-1", {
    lockedAt: new Date().toISOString(),
  });
  assertEquals(typeof locked.lockedAt, "string");
  await resetKv();
});
