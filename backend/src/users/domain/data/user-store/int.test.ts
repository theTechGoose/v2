// REQ-063 — every read path of the store overlays the flag on hans@documonster.com: get, by
// email, the admin search. The stored record is untouched.
import { assertEquals } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "./mod.ts";

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  return new UserStore();
}

Deno.test("REQ-063 user-store — every read path overlays the flag on hans@documonster.com; nobody else gets it", async () => {
  const users = await fresh();
  const hans = await users.create({ email: "Hans@DocuMonster.com", name: "Hans" });
  const art = await users.create({ phoneNumber: "+15125550163", email: "art@documonster.com", name: "Art" });
  assertEquals((await users.get(hans.id)).superAdmin, true, "get");
  assertEquals((await users.findByEmail("hans@documonster.com"))?.superAdmin, true, "by email");
  assertEquals((await users.searchByPhone("")).find((u) => u.id === hans.id)?.superAdmin, true, "the admin search");
  assertEquals((await users.get(art.id)).superAdmin ?? false, false, "no flag on anyone else");
  assertEquals((await users.findByEmail("art@documonster.com"))?.superAdmin ?? false, false);
  // a revoke cannot take it: the overlay is read-time
  await users.setSuperAdmin(hans.id, false);
  assertEquals((await users.get(hans.id)).superAdmin, true, "survives a revoke");
});

// REQ-113 — the paid plan a sign-up named rides its own write path, like the admin flag and the
// onboarding stamp: a PUT /me body (parseUpdateUser passes every field it is given) must not be
// able to name a plan, flip the flag or stamp the wizard — `update` takes the three profile fields
// and nothing else.
Deno.test("REQ-113 user-store — nameSignupPlan keeps the plan a sign-up named; update takes the name, the email and the language only: a patch carrying the plan, the admin flag or the onboarding stamp changes none of them", async () => {
  const users = await fresh();
  const ana = await users.create({ phoneNumber: "+15125551131" });
  assertEquals((await users.nameSignupPlan(ana.id, "monster")).signupPlan, "monster");
  assertEquals((await users.get(ana.id)).signupPlan, "monster", "kept on the record");
  const smuggled = { email: "ana@roof.test", signupPlan: "assist", superAdmin: true, onboardedAt: "2026-10-21T00:00:00.000Z" } as unknown as Parameters<UserStore["update"]>[1];
  const patched = await users.update(ana.id, smuggled);
  assertEquals([patched.email, patched.signupPlan, patched.superAdmin ?? false, patched.onboardedAt], ["ana@roof.test", "monster", false, undefined], "the email landed; nothing else rode in");
  const read = await users.get(ana.id);
  assertEquals([read.signupPlan, read.superAdmin ?? false, read.onboardedAt], ["monster", false, undefined]);
});
