import { assertEquals } from "#std/assert";
import { BusinessIdentityStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("business-identity-store smoke: get on missing user returns null", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new BusinessIdentityStore();
  assertEquals(await store.get("u-1"), null);
  await resetKv();
});

Deno.test("business-identity-store smoke: upsert creates then read returns same record", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new BusinessIdentityStore();
  const created = await store.upsert("u-1", { businessName: "Riley Roofing Co." });
  assertEquals(created.userId, "u-1");
  assertEquals(created.businessName, "Riley Roofing Co.");
  const fetched = await store.get("u-1");
  assertEquals(fetched?.businessName, "Riley Roofing Co.");
  await resetKv();
});

Deno.test("business-identity-store smoke: upsert merges instead of overwriting", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new BusinessIdentityStore();
  await store.upsert("u-1", { businessName: "Riley Roofing Co.", businessLicense: "TX-123" });
  const merged = await store.upsert("u-1", { logoFileId: "file-x" });
  assertEquals(merged.businessName, "Riley Roofing Co.");           // preserved
  assertEquals(merged.businessLicense, "TX-123");                    // preserved
  assertEquals(merged.logoFileId, "file-x");                         // added
  await resetKv();
});

Deno.test("business-identity-store smoke: upsert preserves createdAt and bumps updatedAt", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new BusinessIdentityStore();
  const a = await store.upsert("u-1", { businessName: "First" });
  await new Promise((r) => setTimeout(r, 10));
  const b = await store.upsert("u-1", { businessName: "Second" });
  assertEquals(a.createdAt, b.createdAt);
  if (b.updatedAt <= a.updatedAt) throw new Error(`updatedAt should advance`);
  await resetKv();
});

Deno.test("business-identity-store smoke: delete removes the record", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new BusinessIdentityStore();
  await store.upsert("u-1", { businessName: "Riley Roofing Co." });
  await store.delete("u-1");
  assertEquals(await store.get("u-1"), null);
  await resetKv();
});

Deno.test("business-identity-store smoke: undefined patch values do not erase existing", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new BusinessIdentityStore();
  await store.upsert("u-1", { businessName: "Riley Roofing Co." });
  await store.upsert("u-1", { businessName: undefined, logoFileId: "file-x" });
  const out = await store.get("u-1");
  assertEquals(out?.businessName, "Riley Roofing Co.");              // preserved
  assertEquals(out?.logoFileId, "file-x");
  await resetKv();
});
