import { assert, assertEquals, assertRejects } from "#std/assert";
import { TransferAccount, TransferError } from "./mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { AccountAdminStore } from "@users/domain/data/account-admin-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

/** REQ-220 (+ AMENDMENT: no code) — "Transfer account": a new number takes the account, and that person owns it. */
const OLD = "+15125551234";
const NEW = "+18435550000";

async function world() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const users = new UserStore();
  const sessions = new SessionStore();
  const admins = new AccountAdminStore();
  const transfer = new TransferAccount(users, sessions, admins);
  const owner = await users.create({ phoneNumber: OLD, name: "Old Owner", language: "en" });
  return { users, sessions, admins, transfer, owner };
}

async function refusal(fn: () => Promise<unknown>): Promise<TransferError> {
  return await assertRejects(fn, TransferError) as TransferError;
}

Deno.test("REQ-220 AMENDMENT: the new number alone moves the account — same id, the old number freed, no code anywhere", async () => {
  const w = await world();
  const moved = await w.transfer.run(w.owner, "(843) 555-0000");
  assertEquals(moved.id, w.owner.id);
  assertEquals(moved.phoneNumber, NEW);
  assertEquals(moved.name, "Old Owner");
  assertEquals((await w.users.findByPhone(NEW))?.id, w.owner.id);
  assertEquals(await w.users.findByPhone(OLD), null);
  // no code of any kind was made for either number
  const kv = await getKv();
  assertEquals((await kv.get(["otp", NEW])).value, null);
  assertEquals((await kv.get(["transfer_code", w.owner.id])).value, null);
  // the old number is free: a new account can be born on it
  const born = await w.users.create({ phoneNumber: OLD });
  assert(born.id !== w.owner.id);
  await resetKv();
});

Deno.test("REQ-220: refuses the same number, a taken number (open or closed) and a bad number — nothing moves", async () => {
  const w = await world();
  const same = await refusal(() => w.transfer.run(w.owner, OLD));
  assertEquals([same.error, same.status], ["same_number", 409]);
  const other = await w.users.create({ phoneNumber: NEW });
  const taken = await refusal(() => w.transfer.run(w.owner, NEW));
  assertEquals([taken.error, taken.status], ["phone_taken", 409]);
  await w.users.delete(other.id);
  assertEquals((await refusal(() => w.transfer.run(w.owner, NEW))).error, "phone_taken");
  for (const junk of ["12", "", undefined, 42]) {
    const bad = await refusal(() => w.transfer.run(w.owner, junk));
    assertEquals([bad.error, bad.status], ["bad_phone", 400]);
  }
  assertEquals((await w.users.get(w.owner.id)).phoneNumber, OLD);
  assertEquals((await w.users.findByPhone(OLD))?.id, w.owner.id);
  assertEquals((await w.users.findByPhone(NEW))?.id, other.id);
  await resetKv();
});

Deno.test("REQ-220: the owner's own sessions are dropped; an admin's stay; the new owner's admin invite is removed", async () => {
  const w = await world();
  const own1 = await w.sessions.create(w.owner.id);
  const own2 = await w.sessions.create(w.owner.id);
  const stranger = await w.users.create({ phoneNumber: "+17135550000" });
  const strangerSession = await w.sessions.create(stranger.id);
  const adminUser = await w.users.create({ phoneNumber: "+12105550000" });
  await w.admins.create({ userId: w.owner.id, phoneNumber: adminUser.phoneNumber });
  const acting = await w.sessions.createActing(w.owner.id, adminUser.id);
  // the new owner was an admin of this very account (an invited number with no account of its own)
  await w.admins.create({ userId: w.owner.id, phoneNumber: NEW });

  await w.transfer.run(w.owner, NEW);

  assertEquals(await w.sessions.get(own1.id), null);
  assertEquals(await w.sessions.get(own2.id), null);
  assertEquals((await w.sessions.get(strangerSession.id))?.userId, stranger.id);
  assertEquals((await w.sessions.get(acting.id))?.actorId, adminUser.id);
  assertEquals(await w.admins.find(NEW, w.owner.id), null);
  assertEquals((await w.admins.listByUser(w.owner.id)).map((a) => a.phoneNumber), [adminUser.phoneNumber]);
  await resetKv();
});

Deno.test("REQ-220: an account born from an email login (no phone) takes its first number", async () => {
  const w = await world();
  const mail = await w.users.create({ email: "a@b.test" });
  const moved = await w.transfer.run(mail, NEW);
  assertEquals(moved.phoneNumber, NEW);
  assertEquals((await w.users.findByPhone(NEW))?.id, mail.id);
  await resetKv();
});
