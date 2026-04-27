import { assertEquals } from "#std/assert";
import { RateLimiter } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("rate-limit smoke: first take is always allowed", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const rl = new RateLimiter();
  const r = await rl.take("scope", "key1", 5, 60_000);
  assertEquals(r.allowed, true);
  assertEquals(r.remaining, 4);
  await resetKv();
});

Deno.test("rate-limit smoke: blocks once max is reached", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const rl = new RateLimiter();
  for (let i = 0; i < 5; i++) {
    const r = await rl.take("scope", "key1", 5, 60_000);
    assertEquals(r.allowed, true);
  }
  const sixth = await rl.take("scope", "key1", 5, 60_000);
  assertEquals(sixth.allowed, false);
  assertEquals(sixth.remaining, 0);
  await resetKv();
});

Deno.test("rate-limit smoke: separate keys do not share a bucket", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const rl = new RateLimiter();
  for (let i = 0; i < 3; i++) await rl.take("scope", "k1", 3, 60_000);
  const k1Blocked = await rl.take("scope", "k1", 3, 60_000);
  const k2OK      = await rl.take("scope", "k2", 3, 60_000);
  assertEquals(k1Blocked.allowed, false);
  assertEquals(k2OK.allowed, true);
  await resetKv();
});

Deno.test("rate-limit smoke: separate scopes do not share a bucket", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const rl = new RateLimiter();
  for (let i = 0; i < 2; i++) await rl.take("a", "key", 2, 60_000);
  const aBlocked = await rl.take("a", "key", 2, 60_000);
  const bOK      = await rl.take("b", "key", 2, 60_000);
  assertEquals(aBlocked.allowed, false);
  assertEquals(bOK.allowed, true);
  await resetKv();
});
