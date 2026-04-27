import { assertEquals } from "#std/assert";
import { Logout } from "./mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("logout integration: deletes the session", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const sessions = new SessionStore();
  const flow = new Logout(sessions);

  const session = await sessions.create("user-1");
  const result = await flow.run(session.id);
  assertEquals(result.ok, true);
  assertEquals(await sessions.get(session.id), null);

  await resetKv();
});

Deno.test("logout integration: idempotent on missing session id", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const sessions = new SessionStore();
  const flow = new Logout(sessions);

  const result = await flow.run("never-existed");
  assertEquals(result.ok, true);

  await resetKv();
});
