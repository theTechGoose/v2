import { assertEquals, assertRejects } from "#std/assert";
import { AccountRecovery } from "./mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

/**
 * REQ-039 (NW-52, p58): "When someone signs up with the same phone number,
 * offer to create a new account or recover the old one."
 */
function fresh() {
  const users = new UserStore();
  const sessions = new SessionStore();
  return { users, sessions, recovery: new AccountRecovery(users, sessions) };
}

Deno.test("REQ-039 NW-52 recover: clears deletedAt on the old account and opens a session for it", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { users, sessions, recovery } = fresh();
  const old = await users.create({ phoneNumber: "+15125551234", name: "Old Owner" });
  await users.delete(old.id);
  const token = await recovery.issueToken(old.id);
  const res = await recovery.recover(token);
  assertEquals(res.userId, old.id);
  const user = await users.get(old.id);
  assertEquals(user.deletedAt, undefined);
  assertEquals(user.name, "Old Owner");
  assertEquals((await sessions.get(res.sessionId))?.userId, old.id);
  // One-shot token.
  await assertRejects(() => recovery.recover(token));
  await resetKv();
});

Deno.test("REQ-039 NW-52 start fresh: archives the old account's phone and creates a new account on it", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { users, sessions, recovery } = fresh();
  const old = await users.create({ phoneNumber: "+15125551234", name: "Old Owner", language: "es" });
  await users.delete(old.id);
  const token = await recovery.issueToken(old.id);
  const res = await recovery.startFresh(token);
  assertEquals(res.userId !== old.id, true);
  assertEquals(res.isNewUser, true);
  const fresh_ = await users.get(res.userId);
  assertEquals(fresh_.phoneNumber, "+15125551234");
  assertEquals(fresh_.deletedAt, undefined);
  assertEquals((await users.findByPhone("+15125551234"))?.id, res.userId);
  const archived = await users.get(old.id);
  assertEquals(archived.phoneNumber.startsWith("+15125551234#archived"), true);
  assertEquals(typeof archived.deletedAt, "string");
  assertEquals((await sessions.get(res.sessionId))?.userId, res.userId);
  await resetKv();
});
