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
