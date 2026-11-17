/**
 * REQ-229 — "fix every issue the demo found": demo issues test-setup-claims-pixel-staff-registration
 * and demo-lifecycle-m4. /welcome's CompleteRegistration (REQ-080: "a new account reached /welcome")
 * fired for a staff login and for the customer a staff member impersonated through the demo stage.
 *
 * The integration: the real GET /admin/whoami of the booted users module, read by the shared rule
 * the /welcome page applies (shared/meta-pixel/pixel.ts registrationEventFor) — a person's own
 * session is a registration; the super admin's own session is not; the super admin impersonating
 * the person (the session the demo stage's frame runs on) is not.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import {
  registrationEvent,
  registrationEventFor,
} from "../../../../../shared/meta-pixel/pixel.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9347;
const json = { "content-type": "application/json" };

Deno.test("REQ-229 whoami → CompleteRegistration: the person's own session counts; the staff login and the staff impersonating the person do not", async () => {
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
    const customer = await users.create({ phoneNumber: "+15125550101" });
    const own = (await sessions.create(customer.id)).id;
    assertEquals(
      registrationEventFor(await whoami(own)),
      registrationEvent(customer.id),
      "the person on their own account is the registration",
    );

    const staff = await users.create({
      phoneNumber: "+18438557133",
      name: "Staff",
    });
    const staffSession = (await sessions.create(staff.id)).id;
    assertEquals(
      registrationEventFor(await whoami(staffSession)),
      null,
      "a staff login reaching /welcome is not a registration (pair 4)",
    );

    const res = await fetch(`${base}/admin/impersonate/${customer.id}`, {
      method: "POST",
      headers: { ...json, "x-session-id": staffSession },
    });
    assertEquals(res.status, 200);
    const imp = (await res.json()) as { sessionId: string };
    const who = await whoami(imp.sessionId);
    assertEquals(who.user.id, customer.id, "the frame renders as the person");
    assertEquals(
      registrationEventFor(who),
      null,
      "the staff impersonating the person (the demo stage's frame) is not the person's registration (m4)",
    );
  } finally {
    await app.close();
    await resetKv();
  }
});
