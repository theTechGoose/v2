/**
 * REQ-341 — "fix every issue the demo found" (demo-loop cycle 1, issue M10): the demo stage switched
 * to the CUSTOMER's language on a demo started after the customer chose ES, because /demo/stage read
 * `ctx.state.user.language` and under impersonation that user is the customer. The stage must read
 * the PRESENTER's language: GET /admin/whoami carries `language` on its user views, so
 * `impersonator.language` is the staff's own.
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

const PORT = 9348;
const json = { "content-type": "application/json" };

Deno.test("REQ-341 whoami carries each identity's language: staff en impersonating a customer es → user es, impersonator en", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  await app.listen(PORT);
  const base = `http://localhost:${PORT}`;
  const users = app.get(UserStore);
  const sessions = app.get(SessionStore);
  const whoami = async (sessionId: string) => {
    const res = await fetch(`${base}/admin/whoami`, {
      headers: { ...json, "x-session-id": sessionId },
    });
    assertEquals(res.status, 200);
    return await res.json();
  };
  try {
    const customer = await users.create({
      phoneNumber: "+15125550102",
      language: "es",
    });
    const staff = await users.create({
      phoneNumber: "+18438557133",
      name: "Staff",
      language: "en",
    });
    const staffSession = (await sessions.create(staff.id)).id;
    const own = await whoami(staffSession);
    assertEquals(own.user.language, "en", "the staff's own session says en");
    assertEquals(own.impersonator, null);

    const res = await fetch(`${base}/admin/impersonate/${customer.id}`, {
      method: "POST",
      headers: { ...json, "x-session-id": staffSession },
    });
    assertEquals(res.status, 200);
    const imp = (await res.json()) as { sessionId: string };
    const who = await whoami(imp.sessionId);
    assertEquals(who.impersonating, true);
    assertEquals(who.user.id, customer.id);
    assertEquals(
      who.user.language,
      "es",
      "the frame's user is the customer, es",
    );
    assertEquals(who.impersonator.id, staff.id);
    assertEquals(
      who.impersonator.language,
      "en",
      "the presenter's language rides on impersonator — what the stage must render in",
    );
  } finally {
    await app.close();
    await resetKv();
  }
});
