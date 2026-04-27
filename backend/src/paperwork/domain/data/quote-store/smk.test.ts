import { assertEquals, assertRejects } from "#std/assert";
import { QuoteStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { ForbiddenError } from "@core/data/repository/mod.ts";

Deno.test("quote-store smoke: create + getOwned for owner", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new QuoteStore();
  const created = await store.create("u-1", { summary: "Job", lineItems: [] });
  const fetched = await store.getOwned(created.id, "u-1");
  assertEquals(fetched.summary, "Job");
  assertEquals(fetched.userId, "u-1");
  await resetKv();
});

Deno.test("quote-store smoke: cross-user access denied", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new QuoteStore();
  const c = await store.create("u-1", { summary: "Job", lineItems: [] });
  await assertRejects(() => store.getOwned(c.id, "u-2"), ForbiddenError);
  await resetKv();
});

Deno.test("quote-store smoke: listByUser is per-user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new QuoteStore();
  await store.create("u-1", { summary: "A", lineItems: [] });
  await store.create("u-1", { summary: "B", lineItems: [] });
  await store.create("u-2", { summary: "C", lineItems: [] });
  assertEquals((await store.listByUser("u-1")).length, 2);
  assertEquals((await store.listByUser("u-2")).length, 1);
  await resetKv();
});

Deno.test("quote-store smoke: listByUserAndStatus filters", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new QuoteStore();
  await store.create("u-1", { summary: "A", lineItems: [], status: "draft" });
  await store.create("u-1", { summary: "B", lineItems: [], status: "sent" });
  await store.create("u-1", { summary: "C", lineItems: [], status: "sent" });
  assertEquals((await store.listByUserAndStatus("u-1", "draft")).length, 1);
  assertEquals((await store.listByUserAndStatus("u-1", "sent")).length, 2);
  await resetKv();
});
