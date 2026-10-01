// REQ-054 — choosing a plan end to end on the fakes: the KV plan store and the fake payments
// link (what the real one does against the CRM: customer → due → pay link → due settled).
import { assertEquals, assertRejects } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { fakePaymentsWorld, PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { ChoosePlan } from "./mod.ts";

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("PPWK_PAYMENTS_URL");
  Deno.env.delete("PPWK_PAYMENTS_TOKEN");
  await resetKv();
  fakePaymentsWorld().reset();
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const plans = new PlanStore();
  const link = new PaymentsLink();
  const flow = new ChoosePlan(users, identity, plans, link);
  return { users, identity, plans, link, flow };
}

Deno.test("REQ-054 choose-plan — nobody has a plan until they pick one; free is stored as free", async () => {
  const { users, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550101" });
  assertEquals(await flow.current(user.id), null);
  const plan = await flow.choose(user.id, "free");
  assertEquals(plan.planId, "free");
  assertEquals(plan.status, "free");
  assertEquals((await flow.current(user.id))?.status, "free");
  assertEquals(fakePaymentsWorld().customers.length, 0, "a free plan never touches the CRM");
});

Deno.test("REQ-054 choose-plan — a paid plan makes the CRM customer, raises the first month as a due and mints its pay link", async () => {
  const { users, identity, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550102", email: "ana@roof.test", name: "Ana" });
  await identity.upsert(user.id, { businessName: "Ana Roofing" });
  const plan = await flow.choose(user.id, "monster");
  assertEquals(plan.status, "pending");
  assertEquals(plan.planId, "monster");
  const world = fakePaymentsWorld();
  assertEquals(world.customers.map((c) => [c.customerName, c.customerEmail]), [["Ana Roofing", "ana@roof.test"]]);
  assertEquals(world.dues.map((d) => [d.customerId, d.amountCents, d.memo, d.open]), [[plan.customerId, 9900, "Monster — first month", true]]);
  assertEquals(world.links.map((l) => [l.customerId, l.dueId]), [[plan.customerId, plan.dueId]]);
  assertEquals(plan.payUrl, world.links[0].payUrl);
  // the fake mints the app's own stand-in page (REQ-057); the real client's is /ui/payments/charge (smk.test.ts)
  assertEquals(plan.payUrl?.includes(`/pay/fake?customer=${plan.customerId}&due=${plan.dueId}`), true, "the pay page the link builder makes");
});

Deno.test("REQ-054 choose-plan — a paid plan needs an email on the account; the CRM customer is never invented", async () => {
  const { users, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550103", name: "Nobody" });
  await assertRejects(() => flow.choose(user.id, "assist"), Error, "email-required");
  assertEquals(await flow.current(user.id), null);
  assertEquals(fakePaymentsWorld().customers.length, 0);
});

Deno.test("REQ-054 choose-plan — refresh keeps a pending plan pending while the due is open, and activates it once the due settles", async () => {
  const { users, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550104", email: "b@roof.test" });
  const pending = await flow.choose(user.id, "assist");
  assertEquals((await flow.refresh(user.id)).status, "pending");
  fakePaymentsWorld().settle(pending.dueId!);
  const active = await flow.refresh(user.id);
  assertEquals(active.status, "active");
  assertEquals(typeof active.activatedAt, "string");
  assertEquals((await flow.current(user.id))?.status, "active");
});

Deno.test("REQ-054 choose-plan — an upgrade from free is a new pick: pending on a fresh due, the free record replaced", async () => {
  const { users, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550105", email: "c@roof.test" });
  await flow.choose(user.id, "free");
  const up = await flow.choose(user.id, "monster");
  assertEquals(up.status, "pending");
  assertEquals(fakePaymentsWorld().dues.length, 1);
  assertEquals((await flow.current(user.id))?.planId, "monster");
});

Deno.test("REQ-054 choose-plan — picking a plan that is not selectable is refused", async () => {
  const { users, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550106", email: "d@roof.test" });
  await assertRejects(() => flow.choose(user.id, "projects"), Error, "plan-unknown");
});
