/**
 * REQ-507 — "fix every issue the demo found, loop until there are none." Demo-loop cycle 3,
 * issue m25 ("/admin search confusing"): typing "abc!!" into the /admin users search listed
 * every user, because UserStore.searchByPhone stripped every non-digit and an empty needle
 * matched all. GET /admin/users?q= now matches a phone by its digits and a name, business or
 * email by text; a query that matches nothing returns [] — only a blank query lists everyone.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9507;

Deno.test("REQ-507 m25 GET /admin/users?q= — 'abc!!' lists nobody; a name, a business or a phone finds the user; blank lists everyone", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  await app.listen(PORT);
  const users = app.get(UserStore);
  const sessions = app.get(SessionStore);
  const identities = app.get(BusinessIdentityStore);
  try {
    const admin = await users.create({
      phoneNumber: "+15125551772",
      name: "Rafa",
    });
    await users.setSuperAdmin(admin.id, true);
    const deb = await users.create({
      phoneNumber: "+15125550102",
      name: "Deb Kowalski",
    });
    await identities.upsert(deb.id, { businessName: "Sparkle Home Cleaning" });
    const headers = { "x-session-id": (await sessions.create(admin.id)).id };
    const ids = async (q: string) => {
      const r = await fetch(
        `http://localhost:${PORT}/admin/users?q=${encodeURIComponent(q)}`,
        { headers },
      );
      assertEquals(r.status, 200, `q=${q}`);
      return ((await r.json()) as { id: string }[]).map((u) => u.id).sort();
    };
    assertEquals(await ids("abc!!"), [], "abc!! is not everyone");
    assertEquals(await ids("zzz"), [], "an unknown name matches nobody");
    assertEquals(await ids("Kowalski"), [deb.id], "by name");
    assertEquals(await ids("sparkle"), [deb.id], "by business");
    assertEquals(await ids("5125550102"), [deb.id], "by phone");
    assertEquals(
      await ids(""),
      [admin.id, deb.id].sort(),
      "blank lists everyone",
    );
  } finally {
    await app.close();
  }
});
