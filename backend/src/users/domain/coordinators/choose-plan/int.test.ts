// REQ-054 — choosing a plan end to end on the fakes: the KV plan store and the fake payments
// link (what the real one does against the CRM: customer → due → pay link → due settled).
import { assertEquals, assertRejects, assertStringIncludes } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { fakePaymentsWorld, PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { CrmCaptureOutbox } from "@users/domain/data/crm-capture-outbox/mod.ts";
import { CrmLeadCapture } from "@users/domain/coordinators/crm-lead-capture/mod.ts";
import { ChoosePlan } from "./mod.ts";

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("PPWK_PAYMENTS_URL");
  Deno.env.delete("PPWK_PAYMENTS_TOKEN");
  Deno.env.delete("PPWK_PAYMENTS_ACCOUNT");
  await resetKv();
  fakePaymentsWorld().reset();
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const plans = new PlanStore();
  const link = new PaymentsLink();
  const crm = new CrmCustomerSync(users, identity, link, plans);
  const leads = new CrmLeadCapture(new CrmCaptureOutbox(), crm); // REQ-099 — the tier reaches the CRM by the sweep, after the reply
  const flow = new ChoosePlan(users, plans, link, crm, leads);
  return { users, identity, plans, link, crm, leads, flow };
}

Deno.test("REQ-054 choose-plan — nobody has a plan until they pick one; free is stored as free", async () => {
  const { users, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550101" });
  assertEquals(await flow.current(user.id), null);
  const plan = await flow.choose(user.id, "free");
  await leads.drain(); // REQ-099 — the CRM hears the tier after the reply
  assertEquals(plan.planId, "free");
  assertEquals(plan.status, "free");
  assertEquals((await flow.current(user.id))?.status, "free");
  // REQ-062 — a free pick tells the CRM its tier (Lead) on the account's one customer; no due, no link
  const world = fakePaymentsWorld();
  assertEquals([world.customers.length, world.customers[0]?.tier, world.dues.length, world.links.length], [1, "Lead", 0, 0], "a free plan raises nothing on the CRM");
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
  const atSignUp = await crm.ensure(user.id);
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
    assertEquals(link.returnLabel, "DocuMonster");
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
  assertEquals(sub.returnLabel, "DocuMonster");
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

// REQ-062 — "all financial info and guest info updated in quickbase with tier": the CRM hears
// about the plan the moment it changes, not on the next profile edit
Deno.test("REQ-062 choose-plan — the CRM's tier follows the plan: Monster the moment the first month settles, Lead again on the way back to free", async () => {
  const { users, leads, flow } = await fresh();
  const { user } = await paidAndActive(flow, users, "+15125550601");
  await leads.drain(); // REQ-099 — by the sweep, after the reply
  const world = fakePaymentsWorld();
  const mine = () => world.customers.find((c) => c.externalRef === `pm:${user.id}`);
  assertEquals(mine()?.tier, "Monster", "told the CRM when the due settled");
  await flow.choose(user.id, "free");
  await leads.drain();
  assertEquals(mine()?.tier, "Lead", "told the CRM on the downgrade");
  assertEquals(world.customers.length, 1);
});

// REQ-064 — the hidden $1 one-time test tier, and the merchant account a pick names
Deno.test("REQ-064 choose-plan — the test tier is a $1 one-time due with the merchant on its link; paid, it is active with no billing and the CRM tier stays Lead", async () => {
  const { users, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550164", email: "tester@roof.test", name: "Tess" });
  const plan = await flow.choose(user.id, "test", "/settings", "alpha");
  assertEquals([plan.planId, plan.status, plan.merchant], ["test", "pending", "alpha"]);
  const world = fakePaymentsWorld();
  assertEquals(world.dues.map((d) => [d.amountCents, d.memo, d.open]), [[100, "Monster Test — one-time test charge", true]]);
  assertEquals(world.links[0].merchant, "alpha");
  assertStringIncludes(plan.payUrl ?? "", "merchant=alpha");
  world.settle(plan.dueId!); // the $1 lands on the page; /plan/return refreshes
  const active = await flow.refresh(user.id);
  await leads.drain(); // REQ-099
  assertEquals(active.status, "active");
  assertEquals(active.subscriptionId, undefined, "a one-time charge starts no billing");
  assertEquals(world.subscriptions.length, 0);
  assertEquals(world.customers[0].tier, "Lead", "a test charge is not a membership");
  assertEquals((await flow.current(user.id))?.status, "active");
  assertEquals(world.subscriptions.length, 0, "and reading it again starts none either");
});

Deno.test("REQ-064 choose-plan — a monthly plan picked with a merchant starts its billing on that merchant; none named = none sent", async () => {
  const { users, flow } = await fresh();
  const world = fakePaymentsWorld();
  const named = await users.create({ phoneNumber: "+15125550165", email: "m@roof.test", name: "Mo" });
  const pending = await flow.choose(named.id, "monster", "/settings", "alpha");
  assertEquals(pending.merchant, "alpha");
  world.settle(pending.dueId!);
  assertEquals((await flow.refresh(named.id)).status, "active");
  assertEquals(world.subscriptions.map((s) => [s.externalRef, s.merchant]), [[`pm:${named.id}:monster`, "alpha"]]);
  const plain = await users.create({ phoneNumber: "+15125550166", email: "p@roof.test", name: "Pat" });
  const p2 = await flow.choose(plain.id, "monster");
  assertEquals("merchant" in p2, false);
  world.settle(p2.dueId!);
  assertEquals((await flow.refresh(plain.id)).status, "active");
  assertEquals("merchant" in world.subscriptions[1], false, "nothing named, nothing sent");
});

Deno.test("REQ-071 choose-plan — the pay link's way back is under DocuMonster", async () => {
  const { users, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550171", email: "g@roof.test" });
  await flow.choose(user.id, "assist", "/welcome");
  assertEquals(fakePaymentsWorld().links[0].returnLabel, "DocuMonster");
});
