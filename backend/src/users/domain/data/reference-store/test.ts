import { assertEquals, assertRejects } from "#std/assert";
import { ReferenceStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { ForbiddenError } from "@core/data/repository/mod.ts";

Deno.test("reference-store smoke: create + listByUser returns the records", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ReferenceStore();
  await store.create("u-1", { contactName: "Tom K." });
  await store.create("u-1", { contactName: "Sarah C." });
  const list = await store.listByUser("u-1");
  assertEquals(list.length, 2);
  assertEquals(list.map((r) => r.contactName).sort(), ["Sarah C.", "Tom K."]);
  await resetKv();
});

Deno.test("reference-store smoke: listByUser sorts by position when provided", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ReferenceStore();
  await store.create("u-1", { contactName: "Z", position: 99 });
  await store.create("u-1", { contactName: "A", position: 0 });
  await store.create("u-1", { contactName: "M", position: 50 });
  const list = await store.listByUser("u-1");
  assertEquals(list.map((r) => r.contactName), ["A", "M", "Z"]);
  await resetKv();
});

Deno.test("reference-store smoke: update merges + bumps updatedAt", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ReferenceStore();
  const ref = await store.create("u-1", { contactName: "Tom K.", phoneNumber: "555-1234" });
  await new Promise((r) => setTimeout(r, 5));
  const updated = await store.update(ref.id, "u-1", { email: "tom@example.test" });
  assertEquals(updated.contactName, "Tom K.");
  assertEquals(updated.phoneNumber, "555-1234");
  assertEquals(updated.email, "tom@example.test");
  if (updated.updatedAt <= ref.updatedAt) throw new Error("updatedAt should advance");
  await resetKv();
});

Deno.test("reference-store smoke: cross-user mutate operations are forbidden", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ReferenceStore();
  const ref = await store.create("u-1", { contactName: "Tom K." });
  await assertRejects(() => store.getOwned(ref.id, "u-2"),                      ForbiddenError);
  await assertRejects(() => store.update(ref.id, "u-2", { contactName: "X" }),  ForbiddenError);
  await assertRejects(() => store.delete(ref.id, "u-2"),                        ForbiddenError);
  await resetKv();
});

Deno.test("reference-store smoke: delete removes record + index", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new ReferenceStore();
  const ref = await store.create("u-1", { contactName: "Tom K." });
  await store.delete(ref.id, "u-1");
  assertEquals((await store.listByUser("u-1")).length, 0);
  await resetKv();
});
