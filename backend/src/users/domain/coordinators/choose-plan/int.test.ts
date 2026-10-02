// REQ-054 — choosing a plan end to end on the fakes: the KV plan store and the fake payments
// link (what the real one does against the CRM: customer → due → pay link → due settled).
import { assertEquals, assertRejects } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { fakePaymentsWorld, PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
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
  const crm = new CrmCustomerSync(users, identity, link);
  const flow = new ChoosePlan(users, plans, link, crm);
  return { users, identity, plans, link, crm, flow };
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

Deno.test("REQ-058 choose-plan — the paid pick reuses the customer sign-up made, revised with the account's details: one record, carrying this app's ref", async () => {
  const { users, identity, crm, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550107", language: "en", name: "New user" });
  const atSignUp = await crm.sync(user.id);
  await users.update(user.id, { email: "e@roof.test", name: "Eli" });
  await identity.upsert(user.id, { businessName: "Eli Decks" });
  const plan = await flow.choose(user.id, "monster");
  const world = fakePaymentsWorld();
  assertEquals(world.customers.length, 1, "the pick revised the sign-up customer, never a second one");
  assertEquals(plan.customerId, atSignUp!.customerId);
  assertEquals([world.customers[0].customerName, world.customers[0].customerEmail, world.customers[0].customerPhone, world.customers[0].externalRef], ["Eli Decks", "e@roof.test", "+15125550107", `pm:${user.id}`]);
});

Deno.test("REQ-059 choose-plan — the pay link carries the way back: the app's /plan/return naming the due, under this app's name", async () => {
  const { users, flow } = await fresh();
  const before = Deno.env.get("APP_URL");
  Deno.env.set("APP_URL", "http://localhost:13170");
  try {
    const user = await users.create({ phoneNumber: "+15125550108", email: "f@roof.test" });
    const plan = await flow.choose(user.id, "assist", "/welcome");
    const link = fakePaymentsWorld().links[0];
    assertEquals(link.returnUrl, `http://localhost:13170/plan/return?due=${plan.dueId}&back=%2Fwelcome`);
    assertEquals(link.returnLabel, "Paperwork Monster");
    assertEquals(new URL(plan.payUrl!).searchParams.get("return"), link.returnUrl);
  } finally {
    before === undefined ? Deno.env.delete("APP_URL") : Deno.env.set("APP_URL", before);
  }
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

// REQ-061 — monthly billing: once the first month settles, the CRM bills the card on file every
// month; the plan reads what the billing says (next bill, card, past due); free cancels it; a
// switch of paid plan replaces it.
import { addMonth } from "@users/domain/business/plan/mod.ts";

async function paidAndActive(flow: ChoosePlan, users: UserStore, phone: string) {
  const user = await users.create({ phoneNumber: phone, email: `${phone.slice(-4)}@roof.test`, name: "Rosa" });
  const pending = await flow.choose(user.id, "monster");
  fakePaymentsWorld().settle(pending.dueId!);
  const active = await flow.refresh(user.id);
  return { user, active };
}

Deno.test("REQ-061 choose-plan — the first settled month starts the billing on the CRM: a month out, this app's handle, the way back to settings", async () => {
  const { users, flow } = await fresh();
  const { user, active } = await paidAndActive(flow, users, "+15125550301");
  assertEquals(active.status, "active");
  const world = fakePaymentsWorld();
  assertEquals(world.subscriptions.length, 1, "one billing");
  const sub = world.subscriptions[0];
  assertEquals([sub.customerId, sub.amountCents, sub.memo, sub.externalRef], [active.customerId, 9900, "Monster", `pm:${user.id}:monster`]);
  assertEquals(sub.firstBillAt, addMonth(active.activatedAt!), "the first recurring month is a month after activation");
  assertEquals(sub.returnUrl?.includes("/plan/return?"), true);
  assertEquals(sub.returnLabel, "Paperwork Monster");
  assertEquals(active.subscriptionId, sub.subscriptionId);
  assertEquals(active.nextBillAt, sub.nextBillAt);
  // read again: found by its handle, never started twice
  const again = await flow.current(user.id);
  assertEquals(again?.subscriptionId, sub.subscriptionId);
  assertEquals(world.subscriptions.length, 1);
});

Deno.test("REQ-061 choose-plan — the plan reads what the billing says: the next bill moves when the clock charges; no card makes it past due with the month's page; paid there it is current again", async () => {
  const { users, flow } = await fresh();
  const { user, active } = await paidAndActive(flow, users, "+15125550302");
  const world = fakePaymentsWorld();
  world.bill(active.nextBillAt!);
  const billed = await flow.current(user.id);
  assertEquals(billed?.status, "active");
  assertEquals(billed?.nextBillAt, addMonth(active.nextBillAt!));
  assertEquals([billed?.cardBrand, billed?.cardLast4], ["visa", "1111"]);
  world.dropCard(active.customerId!);
  world.bill(billed!.nextBillAt!);
  const pastDue = await flow.current(user.id);
  assertEquals(pastDue?.status, "past_due");
  assertEquals(pastDue?.planId, "monster", "still the plan");
  assertEquals(pastDue?.payUrl?.includes("/pay/fake?customer="), true, pastDue?.payUrl);
  const due = world.dues.find((d) => pastDue!.payUrl!.includes(`due=${d.dueId}`))!;
  assertEquals(due.open, true);
  world.settle(due.dueId); // paid on the page; /plan/return refreshes
  const back = await flow.refresh(user.id);
  assertEquals(back.status, "active");
  assertEquals(back.nextBillAt, addMonth(billed!.nextBillAt!));
  assertEquals(back.payUrl === pastDue?.payUrl, false, "the past-due page is no longer the plan's page");
});

Deno.test("REQ-061 choose-plan — back to free cancels the billing (and refuses if the CRM will not take it); a switch of paid plan replaces it once the new one is live", async () => {
  const { users, flow } = await fresh();
  const { user, active } = await paidAndActive(flow, users, "+15125550303");
  const world = fakePaymentsWorld();
  // switch: Monster → Monster Assist
  const pending = await flow.choose(user.id, "assist");
  assertEquals(pending.previousSubscriptionId, active.subscriptionId);
  assertEquals(world.subscriptions[0].status, "active", "the old billing runs until the new one is paid");
  world.settle(pending.dueId!);
  const assist = await flow.refresh(user.id);
  assertEquals([assist.planId, assist.status], ["assist", "active"]);
  assertEquals(world.subscriptions.map((s) => [s.externalRef, s.status, s.amountCents]), [[`pm:${user.id}:monster`, "canceled", 9900], [`pm:${user.id}:assist`, "active", 19900]]);
  // free: the billing is canceled
  const free = await flow.choose(user.id, "free");
  assertEquals(free.status, "free");
  assertEquals(world.subscriptions[1].status, "canceled");
  // and a CRM that will not take the cancel keeps the plan as it was
  const { users: users2, plans: plans2, flow: flow2 } = await fresh();
  const second = await paidAndActive(flow2, users2, "+15125550304");
  fakePaymentsWorld().subscriptions.length = 0; // the CRM has lost it: cancel answers subscription-missing
  await assertRejects(() => flow2.choose(second.user.id, "free"));
  assertEquals((await plans2.get(second.user.id))?.status, "active", "the plan stands until the billing is stopped");
});
