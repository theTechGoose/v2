import { assertEquals, assertRejects } from "#std/assert";
import { FileStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import { PAGE_SIZE } from "@files/domain/business/chunk/mod.ts";

Deno.test("file-store smoke: create + readBytes round-trip for a small file", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new FileStore();
  const bytes = new TextEncoder().encode("hello world");
  const meta = await store.create({ userId: "u-1", filename: "hi.txt", mimeType: "text/plain", bytes });
  assertEquals(meta.sizeBytes, 11);
  assertEquals(meta.pageCount, 1);
  const back = await store.readBytes(meta.id);
  assertEquals(new TextDecoder().decode(back), "hello world");
  await resetKv();
});

Deno.test("file-store smoke: chunked file (>60KiB) round-trips byte-perfect", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new FileStore();
  const bytes = new Uint8Array(PAGE_SIZE * 2 + 17);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
  const meta = await store.create({ userId: "u-1", filename: "big.bin", mimeType: "application/octet-stream", bytes });
  assertEquals(meta.pageCount, 3);
  const back = await store.readBytes(meta.id);
  assertEquals(back, bytes);
  await resetKv();
});

Deno.test("file-store smoke: empty bytes still creates a metadata record", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new FileStore();
  const meta = await store.create({ userId: "u-1", filename: "empty.txt", mimeType: "text/plain", bytes: new Uint8Array(0) });
  assertEquals(meta.sizeBytes, 0);
  assertEquals(meta.pageCount, 0);
  const back = await store.readBytes(meta.id);
  assertEquals(back.length, 0);
  await resetKv();
});

Deno.test("file-store smoke: getOwnedMeta and readOwnedBytes enforce ownership", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new FileStore();
  const meta = await store.create({ userId: "u-1", filename: "a.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("x") });
  await assertRejects(() => store.getOwnedMeta(meta.id, "u-2"),  ForbiddenError);
  await assertRejects(() => store.readOwnedBytes(meta.id, "u-2"), ForbiddenError);
  await resetKv();
});

Deno.test("file-store smoke: listByUser is per-user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new FileStore();
  await store.create({ userId: "u-1", filename: "a", mimeType: "text/plain", bytes: new TextEncoder().encode("a") });
  await store.create({ userId: "u-1", filename: "b", mimeType: "text/plain", bytes: new TextEncoder().encode("b") });
  await store.create({ userId: "u-2", filename: "c", mimeType: "text/plain", bytes: new TextEncoder().encode("c") });
  assertEquals((await store.listByUser("u-1")).length, 2);
  assertEquals((await store.listByUser("u-2")).length, 1);
  await resetKv();
});

Deno.test("file-store smoke: delete removes meta + index + every page", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new FileStore();
  const bytes = new Uint8Array(PAGE_SIZE * 3);
  const meta = await store.create({ userId: "u-1", filename: "x", mimeType: "x/x", bytes });
  await store.delete(meta.id, "u-1");
  await assertRejects(() => store.getMeta(meta.id), NotFoundError);
  assertEquals((await store.listByUser("u-1")).length, 0);
  await resetKv();
});

Deno.test("file-store smoke: cross-user delete is forbidden", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new FileStore();
  const meta = await store.create({ userId: "u-1", filename: "x", mimeType: "x/x", bytes: new TextEncoder().encode("x") });
  await assertRejects(() => store.delete(meta.id, "u-2"), ForbiddenError);
  await resetKv();
});

Deno.test("file-store smoke: sha256 in metadata matches the input bytes", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new FileStore();
  const bytes = new TextEncoder().encode("abc");
  const meta = await store.create({ userId: "u-1", filename: "x", mimeType: "x/x", bytes });
  assertEquals(meta.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  await resetKv();
});
