/**
 * REQ-133 — the CRM tells this app a due settled: POST /payments/due-settled { dueId } with the
 * shared token. The watch on that due is looked at at once (SettleWatch), so the plan is active
 * the moment the CRM's settlement lands — no page has to press anything. Closed without the token.
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

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9183;
const TOKEN = "settled-token-REQ133-int";
const json = { "content-type": "application/json" };

Deno.test("REQ-133 POST /payments/due-settled — closed without PPWK_SETTLED_TOKEN or with a wrong one; with it, the watch on the due is looked at now and the plan is active without any read of it", async () => {
  const prev = Deno.env.get("PPWK_SETTLED_TOKEN");
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("PPWK_PAYMENTS_URL");
  Deno.env.delete("PPWK_PAYMENTS_TOKEN");
  Deno.env.delete("PPWK_SETTLED_TOKEN");
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
  const post = (body: unknown, token?: string) => fetch(`${base}/payments/due-settled`, { method: "POST", headers: { ...json, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    const user = await users.create({ phoneNumber: "+15125551333", email: "cb@roof.test", name: "Cal" });
    const h = { ...json, "x-session-id": (await sessions.create(user.id)).id };
    await (await fetch(`${base}/me/plan`, { method: "POST", headers: h, body: JSON.stringify({ planId: "monster" }) })).body?.cancel();
    await leads.idle();
    const pending = (await plans.get(user.id))!;
    assertEquals(pending.status, "pending");
    fakePaymentsWorld().settle(pending.dueId!); // the CRM's settlement job landed …
    let res = await post({ dueId: pending.dueId }, TOKEN);
    assertEquals(res.status, 403, "hard-closed when the server has no token set");
    await res.body?.cancel();
    Deno.env.set("PPWK_SETTLED_TOKEN", TOKEN);
    res = await post({ dueId: pending.dueId }, "wrong");
    assertEquals(res.status, 403);
    await res.body?.cancel();
    res = await post({}, TOKEN);
    assertEquals(res.status, 400, "the due is named");
    await res.body?.cancel();
    res = await post({ dueId: "nobody" }, TOKEN);
    assertEquals(await res.json(), { ok: true, looked: false }, "no watch on that due: acknowledged, nothing to look at");
    assertEquals((await plans.get(user.id))?.status, "pending", "still as stored: nothing read the plan");
    res = await post({ dueId: pending.dueId }, TOKEN); // … and said so
    assertEquals(await res.json(), { ok: true, looked: true });
    await leads.idle();
    assertEquals((await plans.get(user.id))?.status, "active", "active from the notice alone — the store, not a projected read");
  } finally {
    await app.close();
    prev === undefined ? Deno.env.delete("PPWK_SETTLED_TOKEN") : Deno.env.set("PPWK_SETTLED_TOKEN", prev);
    await resetKv();
  }
});
