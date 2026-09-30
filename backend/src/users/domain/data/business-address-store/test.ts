import { assertEquals } from "#std/assert";
import { BusinessAddressStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("business-address-store smoke: get on missing user returns null", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new BusinessAddressStore();
  assertEquals(await store.get("u-1"), null);
  await resetKv();
});

Deno.test("business-address-store smoke: upsert + read round-trips", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new BusinessAddressStore();
  const a = await store.upsert("u-1", { street: "412 Elm St", city: "Austin", state: "TX", postal: "78701" });
  assertEquals(a.city, "Austin");
  assertEquals(a.state, "TX");
  await resetKv();
});

Deno.test("business-address-store smoke: upsert merges (street stays when only postal updated)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new BusinessAddressStore();
  await store.upsert("u-1", { street: "412 Elm St", city: "Austin", state: "TX" });
  const merged = await store.upsert("u-1", { postal: "78701" });
  assertEquals(merged.street, "412 Elm St");
  assertEquals(merged.postal, "78701");
  await resetKv();
});

Deno.test("business-address-store smoke: per-user isolation", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new BusinessAddressStore();
  await store.upsert("u-1", { state: "TX" });
  await store.upsert("u-2", { state: "CA" });
  assertEquals((await store.get("u-1"))?.state, "TX");
  assertEquals((await store.get("u-2"))?.state, "CA");
  await resetKv();
});
