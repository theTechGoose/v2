import { assertEquals } from "#std/assert";
import { ContractDefaultsStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("contract-defaults-store smoke: get on missing user returns null", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ContractDefaultsStore();
  assertEquals(await store.get("u-1"), null);
  await resetKv();
});

Deno.test("contract-defaults-store smoke: upsert creates with all fields then read returns same", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ContractDefaultsStore();
  const created = await store.upsert("u-1", {
    defaultTerms: "Pay within 30 days.",
    paymentInstructions: "Make checks payable to Riley Roofing Co.",
    warrantyMonths: 12,
    terminationNoticeDays: 14,
    disputeResolution: "mediation",
    governingState: "TX",
  });
  assertEquals(created.userId, "u-1");
  assertEquals(created.warrantyMonths, 12);
  assertEquals(created.disputeResolution, "mediation");
  const fetched = await store.get("u-1");
  assertEquals(fetched?.governingState, "TX");
  await resetKv();
});

Deno.test("contract-defaults-store smoke: upsert merges instead of overwriting", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ContractDefaultsStore();
  await store.upsert("u-1", { warrantyMonths: 12, governingState: "TX" });
  const merged = await store.upsert("u-1", { disputeResolution: "arbitration" });
  assertEquals(merged.warrantyMonths, 12);                            // preserved
  assertEquals(merged.governingState, "TX");                          // preserved
  assertEquals(merged.disputeResolution, "arbitration");              // added
  await resetKv();
});

Deno.test("contract-defaults-store smoke: delete removes the record", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ContractDefaultsStore();
  await store.upsert("u-1", { warrantyMonths: 12 });
  await store.delete("u-1");
  assertEquals(await store.get("u-1"), null);
  await resetKv();
});

Deno.test("contract-defaults-store smoke: separate users have isolated records", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ContractDefaultsStore();
  await store.upsert("u-1", { warrantyMonths: 12 });
  await store.upsert("u-2", { warrantyMonths: 24 });
  assertEquals((await store.get("u-1"))?.warrantyMonths, 12);
  assertEquals((await store.get("u-2"))?.warrantyMonths, 24);
  await resetKv();
});
