// REQ-073 — a KV open that fails is not remembered: the next caller opens again instead of
// inheriting the rejection forever.
import { assert, assertEquals, assertRejects } from "#std/assert";
import { getKv, resetKv } from "./mod.ts";

Deno.test("REQ-073 getKv — a failed open is not cached; the next call opens again", async () => {
  await resetKv();
  Deno.env.set("KV_PATH", "/nonexistent-dir-req-073/kv.db");
  try {
    await assertRejects(() => getKv(), Error);
    Deno.env.set("KV_PATH", ":memory:");
    const kv = await getKv();
    await kv.set(["req-073"], 1);
    assertEquals((await kv.get<number>(["req-073"])).value, 1);
    assert(kv, "opened on the retry");
  } finally {
    Deno.env.set("KV_PATH", ":memory:");
    await resetKv();
  }
});
