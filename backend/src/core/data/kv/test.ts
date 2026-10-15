// REQ-073 — a KV open that fails is not remembered: the next caller opens again instead of
// inheriting the rejection forever. The cache under test is its own: the process's KV and
// KV_PATH are shared with every file the parallel unit lane runs, and are never touched here.
import { assertEquals, assertRejects } from "#std/assert";
import { kvCache } from "./mod.ts";

Deno.test("REQ-073 getKv — a failed open is not cached; the next call opens again", async () => {
  const opens: (string | undefined)[] = [];
  let broken = true;
  const cache = kvCache(
    (path) => {
      opens.push(path);
      return broken ? Promise.reject(new Error(`unable to open database file: ${path}`)) : Deno.openKv(":memory:");
    },
    () => (broken ? "/nonexistent-dir-req-073/kv.db" : ":memory:"),
  );
  try {
    await assertRejects(() => cache.get(), Error, "unable to open database file");
    await assertRejects(() => cache.get(), Error, "unable to open database file");
    assertEquals(opens.length, 2, "the rejection was not remembered: the second call opened again");
    broken = false;
    const kv = await cache.get();
    await kv.set(["req-073"], 1);
    assertEquals((await kv.get<number>(["req-073"])).value, 1);
    assertEquals(await cache.get(), kv, "and a good open is the one KV from then on");
    assertEquals(opens, ["/nonexistent-dir-req-073/kv.db", "/nonexistent-dir-req-073/kv.db", ":memory:"]);
  } finally {
    await cache.reset();
  }
});
