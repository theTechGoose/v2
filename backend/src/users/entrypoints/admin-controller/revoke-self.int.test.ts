/**
 * REQ-731 — "fix every issue the demo found, loop until there are none." Demo-loop cycle 5,
 * issue m30 ("Owner can revoke their own admin"): POST /admin/users/:id/revoke only checked
 * that the caller was a super admin, so one click on Revoke on the operator's own /admin row
 * cleared their flag and locked them out (recovery: the gated /admin/bootstrap). The caller
 * can no longer revoke themselves (409 cannot_revoke_self); since the caller is always a super
 * admin and is never the target, a revoke can never leave zero super admins.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9731;

Deno.test("REQ-731 m30 POST /admin/users/:id/revoke — self is refused 409 cannot_revoke_self and stays admin; another admin is revoked", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  await app.listen(PORT);
  const users = app.get(UserStore);
  const sessions = app.get(SessionStore);
  try {
    const alex = await users.create({
      phoneNumber: "+15125551731",
      name: "Alex",
    });
    await users.setSuperAdmin(alex.id, true);
    const sam = await users.create({
      phoneNumber: "+15125551732",
      name: "Sam",
    });
    await users.setSuperAdmin(sam.id, true);
    const headers = { "x-session-id": (await sessions.create(alex.id)).id };
    const revoke = (id: string) =>
      fetch(`http://localhost:${PORT}/admin/users/${id}/revoke`, {
        method: "POST",
        headers,
      });

    const self = await revoke(alex.id);
    const selfBody = await self.text();
    assertEquals(self.status, 409, `self revoke refused (${selfBody})`);
    assertEquals(
      selfBody.includes("cannot_revoke_self"),
      true,
      `names the reason (${selfBody})`,
    );
    assertEquals(
      (await users.get(alex.id)).superAdmin,
      true,
      "the caller is still a super admin",
    );

    const other = await revoke(sam.id);
    assertEquals(other.status, 200, "revoking another admin still works");
    assertEquals(
      ((await other.json()) as { superAdmin: boolean }).superAdmin,
      false,
    );
    assertEquals((await users.get(sam.id)).superAdmin, false);

    // Alex is now the only super admin — the self refusal is what keeps one standing.
    const last = await revoke(alex.id);
    await last.body?.cancel();
    assertEquals(
      last.status,
      409,
      "the last super admin cannot revoke themselves",
    );
    assertEquals((await users.get(alex.id)).superAdmin, true);
  } finally {
    await app.close();
  }
});
