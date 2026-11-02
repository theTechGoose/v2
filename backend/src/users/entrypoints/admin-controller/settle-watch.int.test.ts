/**
 * REQ-131 — the repair is the same code path as the fix: POST /admin/users/:id/settle-watch
 * { dueId, planId } enqueues a watch on a due the CRM holds as paid, for the plan it was paid
 * for; the sweep restores that plan active even when a later unpaid pick replaced the record
 * (Alex: $99 Monster paid, buried under a $399 Assist+ first-month due). Super admin only.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { CrmLeadCapture } from "@users/domain/coordinators/crm-lead-capture/mod.ts";
import { fakePaymentsWorld } from "@users/domain/data/payments-link/mod.ts";
import { chosen } from "@users/domain/business/plan/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9181;
const json = { "content-type": "application/json" };

Deno.test("REQ-131 POST /admin/users/:id/settle-watch — super admin only; enqueues the watch, and the sweep restores the paid plan active over the unpaid pick that buried it; the upgrade then charges the difference", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("PPWK_PAYMENTS_URL");
  Deno.env.delete("PPWK_PAYMENTS_TOKEN");
  await resetKv();
  fakePaymentsWorld().reset();
  const app = new DanetApplication();
  await app.init(TestApp);
  await app.listen(PORT);
  const base = `http://localhost:${PORT}`;
  const users = app.get(UserStore);
  const sessions = app.get(SessionStore);
  const plans = app.get(PlanStore);
  const leads = app.get(CrmLeadCapture);
  try {
    const alex = await users.create({
      phoneNumber: "+15408303528",
      email: "a2z@landscape.test",
      name: "Alexander",
    });
    const alexSession = await sessions.create(alex.id);
    const alexH = { ...json, "x-session-id": alexSession.id };
    // the paid pick, as the world had it: Monster's due settled on the CRM …
    await (await fetch(`${base}/me/plan`, {
      method: "POST",
      headers: alexH,
      body: JSON.stringify({ planId: "monster" }),
    })).body?.cancel();
    await leads.idle();
    const monster = (await plans.get(alex.id))!;
    fakePaymentsWorld().settle(monster.dueId!);
    // … buried under a later $399 first pick (the bug before REQ-132)
    await plans.put(
      chosen(alex.id, "assist-plus", new Date().toISOString(), {
        merchant: "primary",
        customerId: monster.customerId,
        dueId: "due-399",
        payUrl: "http://crm/pay?due=due-399",
      }),
    );
    const body = JSON.stringify({ dueId: monster.dueId, planId: "monster" });
    // not for Alex himself
    let res = await fetch(`${base}/admin/users/${alex.id}/settle-watch`, {
      method: "POST",
      headers: alexH,
      body,
    });
    assertEquals(res.status, 403);
    await res.body?.cancel();
    // the super admin
    const admin = await users.create({
      phoneNumber: "+18438557133",
      name: "Hans",
    });
    await users.setSuperAdmin(admin.id, true);
    const adminH = {
      ...json,
      "x-session-id": (await sessions.create(admin.id)).id,
    };
    res = await fetch(`${base}/admin/users/${alex.id}/settle-watch`, {
      method: "POST",
      headers: adminH,
      body: JSON.stringify({ dueId: monster.dueId }),
    });
    assertEquals(res.status, 400, "the plan the due paid for is named");
    await res.body?.cancel();
    res = await fetch(`${base}/admin/users/${alex.id}/settle-watch`, {
      method: "POST",
      headers: adminH,
      body,
    });
    assertEquals(res.status, 200);
    assertEquals(await res.json(), {
      ok: true,
      userId: alex.id,
      dueId: monster.dueId,
      planId: "monster",
      merchant: "primary",
    });
    await leads.idle();
    const restored = await (await fetch(`${base}/me/plan`, { headers: alexH }))
      .json();
    assertEquals([restored.planId, restored.status, restored.dueId], [
      "monster",
      "active",
      monster.dueId,
    ]);
    const up = await (await fetch(`${base}/me/plan`, {
      method: "POST",
      headers: alexH,
      body: JSON.stringify({ planId: "assist-plus" }),
    })).json();
    assertEquals([up.planId, up.status, up.dueCents, up.switchedFrom], [
      "assist-plus",
      "pending",
      30000,
      "monster",
    ], "$300, the difference");
  } finally {
    await app.close();
    await resetKv();
  }
});
