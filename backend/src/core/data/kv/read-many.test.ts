/** REQ-134 — records behind an index are read in batches of ten, in flight together. */
import { assertEquals } from "#std/assert";
import { chunksOf, readMany } from "./mod.ts";

function fakeKv(present: Record<string, unknown>) {
  const calls: number[] = [];
  const kv = {
    // deno-lint-ignore require-await
    getMany: async (keys: readonly Deno.KvKey[]) => {
      calls.push(keys.length);
      return keys.map((key) => ({ key, value: present[key.join("/")] ?? null, versionstamp: present[key.join("/")] ? "v" : null }));
    },
  } as unknown as Pick<Deno.Kv, "getMany">;
  return { kv, calls };
}

Deno.test("REQ-134 readMany — 25 keys are three getMany calls of at most ten, answered in key order", async () => {
  const present: Record<string, unknown> = {};
  for (let i = 0; i < 25; i++) present[`rec/${i}`] = { i };
  const { kv, calls } = fakeKv(present);
  const keys: Deno.KvKey[] = Array.from({ length: 25 }, (_, i) => ["rec", String(i)]);
  const out = await readMany<{ i: number }>(kv, keys);
  assertEquals(calls.sort((a, b) => b - a), [10, 10, 5]);
  assertEquals(out.map((r) => r?.i), Array.from({ length: 25 }, (_, i) => i));
});

Deno.test("REQ-134 readMany — a missing key answers null in its place; no keys is no call", async () => {
  const { kv, calls } = fakeKv({ "rec/a": { v: "a" }, "rec/c": { v: "c" } });
  const out = await readMany<{ v: string }>(kv, [["rec", "a"], ["rec", "b"], ["rec", "c"]]);
  assertEquals(out.map((r) => r?.v ?? null), ["a", null, "c"]);
  assertEquals(await readMany(kv, []), []);
  assertEquals(calls, [3]);
});

Deno.test("REQ-134 chunksOf — slices in order, the last one short", () => {
  assertEquals(chunksOf([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunksOf([], 10), []);
});
