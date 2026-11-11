import { assert, assertEquals, assertRejects } from "#std/assert";
import { TransferAccount, TransferError } from "./mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { AccountAdminStore } from "@users/domain/data/account-admin-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { TransferCodeStore } from "@users/domain/data/transfer-code-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

/** REQ-220 — "Transfer account": a new number takes the account, and that person owns it. */
const OLD = "+15125551234";
const NEW = "+18435550000";

async function world() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const users = new UserStore();
  const sessions = new SessionStore();
  const admins = new AccountAdminStore();
  const identities = new BusinessIdentityStore();
  const codes = new TransferCodeStore();
  const sms = new SmsService();
  const texts: { to: string; body: string }[] = [];
  // deno-lint-ignore require-await
  sms.send = async (input) => {
    texts.push(input);
    return { ok: true, reason: "test_capture" };
  };
  const transfer = new TransferAccount(users, sessions, codes, sms, admins, identities);
  const owner = await users.create({ phoneNumber: OLD, name: "Old Owner", language: "en" });
  return { users, sessions, admins, identities, codes, texts, transfer, owner };
}

async function refusal(fn: () => Promise<unknown>): Promise<TransferError> {
  return await assertRejects(fn, TransferError) as TransferError;
}

Deno.test("REQ-220 start: texts the NEW number its own code, naming the account, and stores it for the owner", async () => {
  const w = await world();
  await w.identities.upsert(w.owner.id, { businessName: "Acme Roofing" });
  const res = await w.transfer.start(w.owner, "(843) 555-0000");
  assertEquals(res.phoneNumber, NEW);
  assert(/^\d{6}$/.test(res.code));
  assertEquals(w.texts.length, 1);
  assertEquals(w.texts[0].to, NEW);
  assert(w.texts[0].body.includes(res.code));
  assert(w.texts[0].body.includes("Acme Roofing"), w.texts[0].body);
  // its own record — never the sign-in code's
  assertEquals((await (await getKv()).get(["otp", NEW])).value, null);
  assertEquals((await w.codes.get(w.owner.id))?.phoneNumber, NEW);
  // nothing moved yet
  assertEquals((await w.users.get(w.owner.id)).phoneNumber, OLD);
  await resetKv();
});

Deno.test("REQ-220 start: refuses the same number, a taken number (open or closed), a bad number, and a resend inside the cooldown", async () => {
  const w = await world();
  assertEquals((await refusal(() => w.transfer.start(w.owner, OLD))).error, "same_number");
  const other = await w.users.create({ phoneNumber: NEW });
  const taken = await refusal(() => w.transfer.start(w.owner, NEW));
  assertEquals([taken.error, taken.status], ["phone_taken", 409]);
  await w.users.delete(other.id);
  assertEquals((await refusal(() => w.transfer.start(w.owner, NEW))).error, "phone_taken");
  const bad = await refusal(() => w.transfer.start(w.owner, "12"));
  assertEquals([bad.error, bad.status], ["bad_phone", 400]);
  assertEquals(w.texts.length, 0);
  await w.transfer.start(w.owner, "+18435550001");
  const again = await refusal(() => w.transfer.start(w.owner, "+18435550001"));
  assertEquals([again.error, again.status], ["cooldown", 429]);
  assert((again.retryAfterSeconds ?? 0) > 0);
  assertEquals(w.texts.length, 1);
  await resetKv();
});

Deno.test("REQ-220 confirm: the right code moves the account to the new number — same id, the old number freed", async () => {
  const w = await world();
  const { code } = await w.transfer.start(w.owner, NEW);
  const moved = await w.transfer.confirm(w.owner, code);
  assertEquals(moved.id, w.owner.id);
  assertEquals(moved.phoneNumber, NEW);
  assertEquals(moved.name, "Old Owner");
  assertEquals((await w.users.findByPhone(NEW))?.id, w.owner.id);
  assertEquals(await w.users.findByPhone(OLD), null);
  // the old number is free: a new account can be born on it
  const born = await w.users.create({ phoneNumber: OLD });
  assert(born.id !== w.owner.id);
  // one-shot
  assertEquals((await refusal(() => w.transfer.confirm(moved, code))).error, "expired");
  await resetKv();
});

Deno.test("REQ-220 confirm: the owner's own sessions are dropped; an admin's stay; the new owner's admin invite is removed", async () => {
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

  const { code } = await w.transfer.start(w.owner, NEW);
  await w.transfer.confirm(w.owner, code);

  assertEquals(await w.sessions.get(own1.id), null);
  assertEquals(await w.sessions.get(own2.id), null);
  assertEquals((await w.sessions.get(strangerSession.id))?.userId, stranger.id);
  assertEquals((await w.sessions.get(acting.id))?.actorId, adminUser.id);
  assertEquals(await w.admins.find(NEW, w.owner.id), null);
  assertEquals((await w.admins.listByUser(w.owner.id)).map((a) => a.phoneNumber), [adminUser.phoneNumber]);
  await resetKv();
});

Deno.test("REQ-220 confirm: a wrong code is refused and counted; five lock it; nothing moves", async () => {
  const w = await world();
  const { code } = await w.transfer.start(w.owner, NEW);
  const wrong = code === "111111" ? "222222" : "111111";
  for (let i = 0; i < 5; i++) {
    const e = await refusal(() => w.transfer.confirm(w.owner, wrong));
    assertEquals([e.error, e.status], ["invalid_code", 422]); // not 401 — that reads as "signed out"
  }
  const locked = await refusal(() => w.transfer.confirm(w.owner, code));
  assertEquals([locked.error, locked.status], ["rate_limited", 429]);
  assertEquals((await w.users.get(w.owner.id)).phoneNumber, OLD);
  await resetKv();
});

Deno.test("REQ-220 confirm: no pending code is `expired`; a number taken between start and confirm is `phone_taken`", async () => {
  const w = await world();
  const none = await refusal(() => w.transfer.confirm(w.owner, "123456"));
  assertEquals([none.error, none.status], ["expired", 410]);
  const { code } = await w.transfer.start(w.owner, NEW);
  await w.users.create({ phoneNumber: NEW }); // someone signed up on it meanwhile
  const taken = await refusal(() => w.transfer.confirm(w.owner, code));
  assertEquals([taken.error, taken.status], ["phone_taken", 409]);
  assertEquals((await w.users.get(w.owner.id)).phoneNumber, OLD);
  assertEquals((await w.users.findByPhone(OLD))?.id, w.owner.id);
  await resetKv();
});

Deno.test("REQ-220 confirm: an account born from an email login (no phone) takes its first number", async () => {
  const w = await world();
  const mail = await w.users.create({ email: "a@b.test" });
  const { code } = await w.transfer.start(mail, NEW);
  const moved = await w.transfer.confirm(mail, code);
  assertEquals(moved.phoneNumber, NEW);
  assertEquals((await w.users.findByPhone(NEW))?.id, mail.id);
  await resetKv();
});
