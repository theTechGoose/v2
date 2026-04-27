import { assertEquals } from "#std/assert";
import { getKv, resetKv } from "./mod.ts";

Deno.test("kv smoke: round-trip a value through Deno.openKv", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const kv = await getKv();
  await kv.set(["smk", "x"], 123);
  const got = await kv.get<number>(["smk", "x"]);
  assertEquals(got.value, 123);
  await resetKv();
});
