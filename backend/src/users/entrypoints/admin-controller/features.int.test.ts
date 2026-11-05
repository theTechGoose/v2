/**
 * REQ-177 — "put the texting feature behind a feature flag on the account. add a tab called
 * 'accounts' this way we can enable and disable features per account."
 * PUT /admin/users/:id/features { key, on } — super admin only; the flag shows on the admin's
 * user list; a profile PUT can never set it.
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

const PORT = 9184;
const json = { "content-type": "application/json" };

Deno.test("REQ-177 PUT /admin/users/:id/features — super admin only; a known key flips on and off and shows on the list; an unknown key is 400; PUT /me cannot set it", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  await app.listen(PORT);
  const base = `http://localhost:${PORT}`;
  const users = app.get(UserStore);
  const sessions = app.get(SessionStore);
  const call = async (
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: unknown,
  ) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: r.status, body: parsed };
  };
  try {
    const a2z = await users.create({
      phoneNumber: "+15408301771",
      name: "Alexander",
    });
    const rafa = await users.create({
      phoneNumber: "+15125551772",
      name: "Rafa",
    });
    await users.setSuperAdmin(rafa.id, true);
    const aH = { ...json, "x-session-id": (await sessions.create(a2z.id)).id };
    const rH = { ...json, "x-session-id": (await sessions.create(rafa.id)).id };

    // a plain account cannot flip anyone's flags, not even its own
    const denied = await call("PUT", `/admin/users/${a2z.id}/features`, aH, {
      key: "fieldTexts",
      on: true,
    });
    assertEquals(denied.status, 403, JSON.stringify(denied.body));
    assertEquals((await users.get(a2z.id)).features?.fieldTexts, undefined);

    // the super admin turns it on
    const on = await call("PUT", `/admin/users/${a2z.id}/features`, rH, {
      key: "fieldTexts",
      on: true,
    });
    assertEquals(on.status, 200, JSON.stringify(on.body));
    assertEquals(on.body.features, { fieldTexts: true });
    const listed = await call("GET", "/admin/users?q=5408301771", rH);
    assertEquals(listed.body.map((u: any) => [u.id, u.features]), [[a2z.id, {
      fieldTexts: true,
    }]]);

    // an unknown key is refused
    const bad = await call("PUT", `/admin/users/${a2z.id}/features`, rH, {
      key: "superAdmin",
      on: true,
    });
    assertEquals(bad.status, 400, JSON.stringify(bad.body));
    assertEquals((await users.get(a2z.id)).superAdmin, undefined);

    // a profile PUT drops it
    const me = await call("PUT", "/me", aH, {
      name: "Alexander",
      features: { fieldTexts: false },
    });
    assertEquals(me.status, 200);
    assertEquals((await users.get(a2z.id)).features, { fieldTexts: true });

    // and off again
    const off = await call("PUT", `/admin/users/${a2z.id}/features`, rH, {
      key: "fieldTexts",
      on: false,
    });
    assertEquals(off.body.features, { fieldTexts: false });
  } finally {
    await app.close();
    await resetKv();
  }
});
