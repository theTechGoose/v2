import { assertEquals } from "#std/assert";
import { BusinessInsuranceStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("business-insurance-store smoke: get on missing user returns null", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new BusinessInsuranceStore();
  assertEquals(await store.get("u-1"), null);
  await resetKv();
});

Deno.test("business-insurance-store smoke: upsert + read round-trips with cents", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new BusinessInsuranceStore();
  const a = await store.upsert("u-1", {
    provider: "Hartford",
    policyNumber: "GL-12345",
    coverageCents: 100_000_000,
    expiresAt: "2027-01-01",
  });
  assertEquals(a.coverageCents, 100_000_000);
  assertEquals(a.provider, "Hartford");
  await resetKv();
});

Deno.test("business-insurance-store smoke: upsert merges (provider stays when only expiresAt updated)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new BusinessInsuranceStore();
  await store.upsert("u-1", { provider: "Hartford", policyNumber: "GL-12345" });
  const merged = await store.upsert("u-1", { expiresAt: "2027-01-01" });
  assertEquals(merged.provider, "Hartford");
  assertEquals(merged.expiresAt, "2027-01-01");
  await resetKv();
});
