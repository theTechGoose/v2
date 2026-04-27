import { assert, assertEquals } from "#std/assert";
import { maskTin, TaxIdentityStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("maskTin: replaces all but last-4 with mask", () => {
  assertEquals(maskTin("123-45-6789"), "***-**-6789");
  assertEquals(maskTin("123456789"),    "***-**-6789");
});

Deno.test("maskTin: <4 digits → fully masked", () => {
  assertEquals(maskTin("12"), "***-**-****");
  assertEquals(maskTin(""),    "***-**-****");
});

Deno.test("tax-identity-store smoke: get on missing user returns null", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new TaxIdentityStore();
  assertEquals(await store.get("u-1"), null);
  await resetKv();
});

Deno.test("tax-identity-store smoke: update with TIN stores hash + salt + mask, NOT raw", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new TaxIdentityStore();
  const out = await store.update("u-1", { tin: "123-45-6789" });
  assertEquals(out.tinMasked, "***-**-6789");
  assert(out.tinHashed && out.tinHashed.length === 64, "tinHashed should be sha256-hex (64 chars)");
  assert(out.tinSalt && out.tinSalt.length === 64,   "tinSalt should be 32-byte hex (64 chars)");
  assert(!("tin" in out), "raw TIN must NEVER be persisted");
  await resetKv();
});

Deno.test("tax-identity-store smoke: verifyTin matches the same TIN, rejects others", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new TaxIdentityStore();
  await store.update("u-1", { tin: "987-65-4321" });
  assertEquals(await store.verifyTin("u-1", "987-65-4321"), true);
  assertEquals(await store.verifyTin("u-1", "111-22-3333"), false);
  await resetKv();
});

Deno.test("tax-identity-store smoke: verifyTin returns false when no TIN stored", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new TaxIdentityStore();
  assertEquals(await store.verifyTin("u-1", "123-45-6789"), false);
  await resetKv();
});

Deno.test("tax-identity-store smoke: w9FileId roundtrips with auto-set w9UploadedAt", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new TaxIdentityStore();
  const out = await store.update("u-1", { w9FileId: "file-abc" });
  assertEquals(out.w9FileId, "file-abc");
  assert(typeof out.w9UploadedAt === "string");
  await resetKv();
});

Deno.test("tax-identity-store smoke: deleteW9 removes file pointer but keeps TIN data", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new TaxIdentityStore();
  await store.update("u-1", { w9FileId: "file-abc", tin: "123-45-6789" });
  const after = await store.deleteW9("u-1");
  assertEquals(after?.w9FileId, undefined);
  assertEquals(after?.w9UploadedAt, undefined);
  assert(after?.tinHashed, "TIN data should be preserved");
  await resetKv();
});

Deno.test("tax-identity-store smoke: re-storing the same TIN produces a different hash (new salt)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new TaxIdentityStore();
  const first  = await store.update("u-1", { tin: "987-65-4321" });
  const second = await store.update("u-1", { tin: "987-65-4321" });
  assert(first.tinHashed !== second.tinHashed, "rotating salt → rotating hash");
  await resetKv();
});
