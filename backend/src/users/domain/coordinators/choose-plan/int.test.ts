// REQ-054 — choosing a plan end to end on the fakes: the KV plan store and the fake payments
// link (what the real one does against the CRM: customer → due → pay link → due settled).
// REQ-106 — the paid pick replies before the CRM is reached: the customer, the due and the pay
// link are minted by the outbox's sweep after the reply, and land on the plan's record; `pick`
// below is a pick followed by that sweep, read back — what the pay page sees once it is there.
import { assert, assertEquals, assertRejects, assertStringIncludes } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { fakePaymentsWorld, PaymentsLink, type PaymentsLinkPort } from "@users/domain/data/payments-link/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { CrmCaptureOutbox } from "@users/domain/data/crm-capture-outbox/mod.ts";
import { CrmLeadCapture } from "@users/domain/coordinators/crm-lead-capture/mod.ts";
import { PayLinkMint } from "@users/domain/coordinators/pay-link-mint/mod.ts";
import { SettleWatch } from "@users/domain/coordinators/settle-watch/mod.ts"; // REQ-131
import { SignupNotice } from "@users/domain/coordinators/signup-notice/mod.ts";
import { chosen, type PickBack } from "@users/domain/business/plan/mod.ts";
import { ChoosePlan } from "./mod.ts";

/** the sweep the previous test left in flight: a fixture waits for it before it resets the world
 *  and the KV, or that sweep's mint lands in this test's fake world (REQ-384: one test's "primary"
 *  link was the next test's links[0] under the gate's load) */
let previous: CrmLeadCapture | null = null;

async function fresh() {
  await previous?.idle();
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("PPWK_PAYMENTS_URL");
  Deno.env.delete("PPWK_PAYMENTS_TOKEN");
  await resetKv();
  fakePaymentsWorld().reset();
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const plans = new PlanStore();
  const link = new PaymentsLink();
  const crm = new CrmCustomerSync(users, identity, link, plans);
  const mint = new PayLinkMint(plans, link, crm); // REQ-106 — the pay link, by the sweep
  const leads = new CrmLeadCapture(new CrmCaptureOutbox(), crm, new SignupNotice(users), mint, new SettleWatch(plans, link)); // REQ-099 — the tier reaches the CRM by the sweep, after the reply
  const flow = new ChoosePlan(users, plans, link, crm, leads);
  previous = leads;
  return { users, identity, plans, link, crm, mint, leads, flow };
}

/** REQ-106 — a pick, the sweeps that follow it (the page's, and any sync already in flight), and
 *  the record as the pay page then sees it */
async function pick(flow: ChoosePlan, leads: CrmLeadCapture, userId: string, planId: string, back: PickBack = "/settings", merchant = "") {
  await flow.choose(userId, planId, back, merchant);
  await leads.idle();
  return (await flow.current(userId))!;
}

Deno.test("REQ-054 choose-plan — nobody has a plan until they pick one; free is stored as free", async () => {
  const { users, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550101" });
  assertEquals(await flow.current(user.id), null);
  const plan = await flow.choose(user.id, "free");
  await leads.idle(); // REQ-099 — the CRM hears the tier after the reply
  assertEquals(plan.planId, "free");
  assertEquals(plan.status, "free");
  assertEquals((await flow.current(user.id))?.status, "free");
  // REQ-062 — a free pick tells the CRM its tier (Lead) on the account's one customer; no due, no link
  const world = fakePaymentsWorld();
  assertEquals([world.customers.length, world.customers[0]?.tier, world.dues.length, world.links.length], [1, "Free", 0, 0], "a free plan raises nothing on the CRM; its tier is the ladder's Free rung (REQ-111)");
});

Deno.test("REQ-054 choose-plan — a paid plan makes the CRM customer, raises the first month as a due and mints its pay link", async () => {
  const { users, identity, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550102", email: "ana@roof.test", name: "Ana" });
  await identity.upsert(user.id, { businessName: "Ana Roofing" });
  const plan = await pick(flow, leads, user.id, "monster"); // REQ-106 — the page comes by the sweep
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

// REQ-106 — Raphael, 2026-10-20: "when i click a plan in the onboarding flow the payment link
// takes FOREVER to load, can we speed it up and keep the exact same result in the crm? i dont
// care if it happens asyncronously it takes that amount of time anyway so as long as it ends up
// where its going fine. what i care about is that the user experience is good."
Deno.test("REQ-106 choose-plan — the paid pick replies before the CRM is reached: pending, the account decided, no page yet; the sweep then makes the same customer, due and link, and the record carries the page", async () => {
  const { users, identity, plans, link, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125551061", email: "ana@roof.test", name: "Ana" });
  await identity.upsert(user.id, { businessName: "Ana Roofing" });
  // the CRM holds the customer write, as its cold start and Quickbase hold the real one
  const inner = new PaymentsLink();
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  let reached = 0;
  const slow: PaymentsLinkPort = {
    createCustomer: async (input) => {
      reached++;
      await held;
      return await inner.createCustomer(input);
    },
    findCustomer: (ref) => inner.findCustomer(ref),
    raiseDue: (input) => inner.raiseDue(input),
    mintPayLink: (input) => inner.mintPayLink(input),
    dueOpen: (id) => inner.dueOpen(id),
    startSubscription: (input) => inner.startSubscription(input),
    findSubscription: (ref) => inner.findSubscription(ref),
    subscription: (id) => inner.subscription(id),
    cancelSubscription: (id, why) => inner.cancelSubscription(id, why),
  };
  link.portOverride = slow;
  const t0 = Date.now();
  const reply = await flow.choose(user.id, "monster", "/welcome");
  const took = Date.now() - t0;
  assert(took < 500, `the reply came at once, not after the CRM (${took} ms)`);
  assertEquals([reply.status, reply.planId, reply.merchant, reply.payUrl, reply.customerId, reply.dueId], ["pending", "monster", "primary", undefined, undefined, undefined], "pending with the account decided; the page still to come");
  assertEquals((await plans.get(user.id))?.payUrl, undefined, "the record says so too");
  const world = fakePaymentsWorld();
  assertEquals([world.dues.length, world.links.length], [0, 0], "nothing raised yet: the CRM is still holding the customer");
  // the CRM answers: the sweep finishes the same three steps the reply used to wait on
  release();
  await leads.idle();
  const plan = (await flow.current(user.id))!;
  assertEquals(reached, 1, "the customer was written once");
  assertEquals(world.customers.map((c) => [c.customerName, c.customerEmail, c.externalRef]), [["Ana Roofing", "ana@roof.test", `pm:${user.id}`]]);
  assertEquals(world.dues.map((d) => [d.customerId, d.amountCents, d.memo, d.open]), [[plan.customerId, 9900, "Monster — first month", true]]);
  assertEquals(world.links.map((l) => [l.customerId, l.dueId, l.merchant, l.returnLabel]), [[plan.customerId, plan.dueId, "primary", "DocuMonster"]]);
  assertEquals(plan.payUrl, world.links[0].payUrl, "the record carries the page");
  assertEquals([plan.status, plan.planId, plan.chosenAt, plan.payLinkError], ["pending", "monster", reply.chosenAt, undefined], "the same pick, now with its page");
  assertStringIncludes(world.links[0].returnUrl ?? "", "/plan/return?due=", "the way back the pick named");
  assertStringIncludes(world.links[0].returnUrl ?? "", "back=%2Fwelcome");
  // the rest is as it was: the due settles on that page and the plan goes active
  world.settle(plan.dueId!);
  assertEquals((await flow.refresh(user.id)).status, "active");
});

Deno.test("REQ-058 choose-plan — the paid pick reuses the customer sign-up made, revised with the account's details: one record, carrying this app's ref", async () => {
  const { users, identity, crm, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550107", language: "en", name: "New user" });
  const atSignUp = await crm.ensure(user.id);
  await users.update(user.id, { email: "e@roof.test", name: "Eli" });
  await identity.upsert(user.id, { businessName: "Eli Decks" });
  const plan = await pick(flow, leads, user.id, "monster");
  const world = fakePaymentsWorld();
  assertEquals(world.customers.length, 1, "the pick revised the sign-up customer, never a second one");
  assertEquals(plan.customerId, atSignUp!.customerId);
  assertEquals([world.customers[0].customerName, world.customers[0].customerEmail, world.customers[0].customerPhone, world.customers[0].externalRef], ["Eli Decks", "e@roof.test", "+15125550107", `pm:${user.id}`]);
});

Deno.test("REQ-059 choose-plan — the pay link carries the way back: the app's /plan/return naming the due, under this app's name", async () => {
  const { users, leads, flow } = await fresh();
  const before = Deno.env.get("APP_URL");
  Deno.env.set("APP_URL", "http://localhost:13170");
  try {
    const user = await users.create({ phoneNumber: "+15125550108", email: "f@roof.test" });
    const plan = await pick(flow, leads, user.id, "assist", "/welcome");
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
  const { users, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550104", email: "b@roof.test" });
  const pending = await pick(flow, leads, user.id, "assist");
  assertEquals((await flow.refresh(user.id)).status, "pending");
  fakePaymentsWorld().settle(pending.dueId!);
  const active = await flow.refresh(user.id);
  assertEquals(active.status, "active");
  assertEquals(typeof active.activatedAt, "string");
  assertEquals((await flow.current(user.id))?.status, "active");
});

Deno.test("REQ-054 choose-plan — an upgrade from free is a new pick: pending on a fresh due, the free record replaced", async () => {
  const { users, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550105", email: "c@roof.test" });
  await flow.choose(user.id, "free");
  const up = await pick(flow, leads, user.id, "monster");
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
import { addMonth, firstOfNextMonth, proratedCents } from "@users/domain/business/plan/mod.ts";

async function paidAndActive(flow: ChoosePlan, leads: CrmLeadCapture, users: UserStore, phone: string) {
  const user = await users.create({ phoneNumber: phone, email: `${phone.slice(-4)}@roof.test`, name: "Rosa" });
  const pending = await pick(flow, leads, user.id, "monster");
  fakePaymentsWorld().settle(pending.dueId!);
  const active = await flow.refresh(user.id);
  return { user, active };
}

Deno.test("REQ-061 choose-plan — the first settled month starts the billing on the CRM: on the next 1st (REQ-129), this app's handle, the way back to settings", async () => {
  const { users, leads, flow } = await fresh();
  const { user, active } = await paidAndActive(flow, leads, users, "+15125550301");
  assertEquals(active.status, "active");
  const world = fakePaymentsWorld();
  assertEquals(world.subscriptions.length, 1, "one billing");
  const sub = world.subscriptions[0];
  assertEquals([sub.customerId, sub.amountCents, sub.memo, sub.externalRef], [active.customerId, 9900, "Monster", `pm:${user.id}:monster`]);
  assertEquals(active.paidThrough, addMonth(active.activatedAt!), "the first month pays through a calendar month later (REQ-129)");
  assertEquals(sub.firstBillAt, firstOfNextMonth(active.activatedAt!), "the first recurring bill is the 1st of the month after activation (REQ-129)");
  assertEquals(sub.firstAmountCents, proratedCents(9900, active.paidThrough!), "for the days of that month past paidThrough");
  assertEquals(active.nextBillCents, sub.firstAmountCents, "the plan says what the next bill is for");
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
  const { users, leads, flow } = await fresh();
  const { user, active } = await paidAndActive(flow, leads, users, "+15125550302");
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
  const { users, leads, flow } = await fresh();
  const { user, active } = await paidAndActive(flow, leads, users, "+15125550303");
  const world = fakePaymentsWorld();
  // switch: Monster → Monster Assist
  const pending = await pick(flow, leads, user.id, "assist");
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
  const { users: users2, plans: plans2, leads: leads2, flow: flow2 } = await fresh();
  const second = await paidAndActive(flow2, leads2, users2, "+15125550304");
  fakePaymentsWorld().subscriptions.length = 0; // the CRM has lost it: cancel answers subscription-missing
  await assertRejects(() => flow2.choose(second.user.id, "free"));
  assertEquals((await plans2.get(second.user.id))?.status, "active", "the plan stands until the billing is stopped");
});

// REQ-062 — "all financial info and guest info updated in quickbase with tier": the CRM hears
// about the plan the moment it changes, not on the next profile edit
Deno.test("REQ-062 choose-plan — the CRM's tier follows the plan: Monster the moment the first month settles, Lead again on the way back to free", async () => {
  const { users, leads, flow } = await fresh();
  const { user } = await paidAndActive(flow, leads, users, "+15125550601");
  await leads.idle(); // REQ-099 — by the sweep, after the reply
  const world = fakePaymentsWorld();
  const mine = () => world.customers.find((c) => c.externalRef === `pm:${user.id}`);
  assertEquals(mine()?.tier, "Monster", "told the CRM when the due settled");
  await flow.choose(user.id, "free");
  await leads.idle();
  assertEquals(mine()?.tier, "Free", "told the CRM on the downgrade — the Free rung (REQ-111)");
  assertEquals(world.customers.length, 1);
});

// REQ-064 — the hidden $1 one-time test tier, and the merchant account a pick names
// REQ-101 — an account the operator added on the CRM is admitted by name; the fake's record is the stand-in
Deno.test("REQ-064 choose-plan — the test tier is a $1 one-time due with the merchant on its link; paid, it is active with no billing and the CRM tier stays Lead", async () => {
  const { users, leads, flow } = await fresh();
  const world = fakePaymentsWorld();
  world.accounts.add("alpha"); // REQ-101 — on record, so it can be named
  const user = await users.create({ phoneNumber: "+15125550164", email: "tester@roof.test", name: "Tess" });
  const plan = await pick(flow, leads, user.id, "test", "/settings", "alpha");
  assertEquals([plan.planId, plan.status, plan.merchant], ["test", "pending", "alpha"]);
  assertEquals(world.dues.map((d) => [d.amountCents, d.memo, d.open]), [[100, "Monster Test — one-time test charge", true]]);
  assertEquals(world.links[0].merchant, "alpha");
  assertStringIncludes(plan.payUrl ?? "", "account=alpha");
  world.settle(plan.dueId!); // the $1 lands on the page; /plan/return refreshes
  const active = await flow.refresh(user.id);
  await leads.idle(); // REQ-099
  assertEquals(active.status, "active");
  assertEquals(active.subscriptionId, undefined, "a one-time charge starts no billing");
  assertEquals(world.subscriptions.length, 0);
  assertEquals(world.customers[0].tier, "Lead", "a test charge is not a membership");
  assertEquals((await flow.current(user.id))?.status, "active");
  assertEquals(world.subscriptions.length, 0, "and reading it again starts none either");
});

Deno.test("REQ-064 choose-plan — a monthly plan picked with a merchant starts its billing on that merchant", async () => {
  const { users, leads, flow } = await fresh();
  const world = fakePaymentsWorld();
  world.accounts.add("alpha"); // REQ-101 — on record, so it can be named
  const named = await users.create({ phoneNumber: "+15125550165", email: "m@roof.test", name: "Mo" });
  const pending = await pick(flow, leads, named.id, "monster", "/settings", "alpha");
  assertEquals(pending.merchant, "alpha");
  world.settle(pending.dueId!);
  assertEquals((await flow.refresh(named.id)).status, "active");
  assertEquals(world.subscriptions.map((s) => [s.externalRef, s.merchant]), [[`pm:${named.id}:monster`, "alpha"]]);
});

// REQ-100 — "THERE NEEDS TO BE A SINGLE SOURCE OF TRUTH WHEN IT REGARDS TO WHAT ACCOUNT IS BEING
// USED": a plan pick that names nothing goes through `primary` — the one rule in
// shared/quote-flow/merchant-accounts.ts — on the link, on the plan's record and on the billing;
// no env var has a say (PPWK_PAYMENTS_ACCOUNT=sandbox is what charged a real customer's $99 on the
// test account on 2026-10-12)
Deno.test("REQ-100 choose-plan — a plan pick naming nothing goes through primary: the pay link, the plan's record and the monthly billing all say primary, whatever PPWK_PAYMENTS_ACCOUNT says", async () => {
  const { users, leads, flow } = await fresh();
  Deno.env.set("PPWK_PAYMENTS_ACCOUNT", "sandbox"); // the old knob, still set on some box: ignored
  try {
    const world = fakePaymentsWorld();
    const user = await users.create({ phoneNumber: "+15125550100", email: "one@roof.test", name: "One" });
    const pending = await pick(flow, leads, user.id, "monster", "/welcome");
    assertEquals(pending.merchant, "primary", "the record");
    assertEquals(new URL(pending.payUrl!).searchParams.get("account"), "primary", "the pay page's url");
    assertEquals(world.links[0].merchant, "primary", "the link the CRM holds");
    world.settle(pending.dueId!);
    assertEquals((await flow.refresh(user.id)).status, "active");
    assertEquals(world.subscriptions.map((s) => s.merchant), ["primary"], "the billing");
    const again = await users.create({ phoneNumber: "+15125550101", email: "two@roof.test", name: "Two" });
    assertEquals((await flow.choose(again.id, "assist", "/settings")).merchant, "primary", "every public plan — decided at the reply (REQ-106)");
  } finally {
    Deno.env.delete("PPWK_PAYMENTS_ACCOUNT");
  }
});

// REQ-101 — "PRIMARY IS THE ACUTAL ACCOUNT AND SANDBOX IS THE FAKE ACCOUNT BUT WE CAN ADD MORE"
// REQ-106 — the CRM's refusal by name arrives after the reply: the pick reads it, nothing is
// minted, and the next pick clears it
Deno.test("REQ-101 choose-plan — the $1 test tier goes through sandbox unless the pick names another account; primary named is primary; a name the CRM has no record of is refused by name, nothing minted, and the pick reads the refusal until the next pick", async () => {
  const { users, plans, leads, flow } = await fresh();
  const world = fakePaymentsWorld();
  const user = await users.create({ phoneNumber: "+15125550102", email: "tst@roof.test", name: "Tst" });
  const sandbox = await pick(flow, leads, user.id, "test", "/settings");
  assertEquals([sandbox.merchant, new URL(sandbox.payUrl!).searchParams.get("account"), world.links[0].merchant], ["sandbox", "sandbox", "sandbox"]);
  const primary = await pick(flow, leads, user.id, "test", "/settings", "primary");
  assertEquals([primary.merchant, world.links[1].merchant], ["primary", "primary"]);
  const refused = await pick(flow, leads, user.id, "monster", "/settings", "alpha");
  assertEquals([refused.status, refused.merchant, refused.payUrl, refused.payLinkError], ["pending", "alpha", undefined, "merchant-unknown"], "the pick reads the CRM's refusal by name");
  assertEquals(world.links.length, 2, "nothing minted for a name not on record");
  assertEquals(world.dues.length, 3, "the due was raised before the CRM refused the link, as before");
  // the next pick clears it: primary again, minted
  const again = await pick(flow, leads, user.id, "test", "/settings", "primary");
  assertEquals([again.merchant, again.payLinkError, world.links.length], ["primary", undefined, 3]);
  assertEquals((await plans.get(user.id))?.payUrl, again.payUrl);
});

Deno.test("REQ-071 choose-plan — the pay link's way back is under DocuMonster", async () => {
  const { users, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125550171", email: "g@roof.test" });
  await pick(flow, leads, user.id, "assist", "/welcome");
  assertEquals(fakePaymentsWorld().links[0].returnLabel, "DocuMonster");
});

/**
 * REQ-112 — "Whenever someone completes signup … automatically send an email to
 * hello@documonster.com. Include … payment status where applicable." A paid pick whose due settles
 * is a completed signup: the notice goes out with "paid" — on the fakes, logged (REQ-318).
 */
Deno.test("REQ-112 choose-plan — the first month settling sends the signup notice with 'paid' and the plan on it, after the reply", async () => {
  const { users, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125551121", email: "p@roof.test", name: "Pat" });
  const pending = await pick(flow, leads, user.id, "monster", "/welcome");
  const logged: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  try {
    fakePaymentsWorld().settle(pending.dueId!);
    const active = await flow.refresh(user.id);
    assertEquals(active.status, "active");
    await leads.idle();
  } finally {
    console.log = log;
  }
  const notice = logged.find((l) => l.includes("[signup-notice] fakes: would mail hello@documonster.com"));
  assertStringIncludes(notice ?? "(no notice logged)", "DocuMonster signup — paid — Monster — +15125551121");
});

/**
 * REQ-118 — Raphael, 2026-10-22: "add another tier called monster assist + 399". Monster Assist+
 * is a $399 monthly plan, picked and billed like Monster and Monster Assist: the first month is a
 * $399 due named for it, paid it is active with a $399 monthly billing, and the CRM customer's
 * tier is its name. REQ-119 — Raphael, 2026-10-23: "the monster assist + is a hidden item that can
 * only be shown in the settings upgrade panel not on the onboarding panel." — hidden from the
 * site; the pick is made from settings.
 */
Deno.test("REQ-118 + REQ-119 choose-plan — Monster Assist+ is picked like any paid plan (from settings): a $399 first-month due named for it, active once paid with a $399 monthly billing, the CRM tier Monster Assist+", async () => {
  const { users, identity, leads, flow } = await fresh();
  const world = fakePaymentsWorld();
  const user = await users.create({ phoneNumber: "+15125551181", email: "plus@roof.test", name: "Pat" });
  await identity.upsert(user.id, { businessName: "Pat Builders" });
  const pending = await pick(flow, leads, user.id, "assist-plus");
  assertEquals([pending.planId, pending.status, pending.merchant], ["assist-plus", "pending", "primary"]);
  assertEquals(world.dues.map((d) => [d.customerId, d.amountCents, d.memo, d.open]), [[pending.customerId, 39900, "Monster Assist+ — first month", true]]);
  assertEquals(world.customers.map((c) => [c.customerName, c.tier]), [["Pat Builders", "Lead"]], "a Lead until the first month is paid");
  world.settle(pending.dueId!);
  const active = await flow.refresh(user.id);
  await leads.idle(); // REQ-099 — the tier reaches the CRM by the sweep
  assertEquals([active.planId, active.status], ["assist-plus", "active"]);
  assertEquals(world.subscriptions.map((s) => [s.externalRef, s.status, s.amountCents]), [[`pm:${user.id}:assist-plus`, "active", 39900]]);
  assertEquals(world.customers.map((c) => [c.customerName, c.tier]), [["Pat Builders", "Monster Assist+"]], "the plan's name is the tier");
});

// ---- REQ-127 — an upgrade charges the difference, a downgrade refunds nothing ----------------
// Raphael, 2026-11-02: "i see alex paid $99, it seems that he picked the wrong plan, but when he
// upgrades its trying to charge him 399 not 300 for the difference." / "upgrade charges the
// difference, downgrade has no refund"

Deno.test("REQ-127 choose-plan — an upgrade from an active plan raises the difference, named for both plans; paid, the new billing runs at the new price a month on and the old one is canceled", async () => {
  const { users, leads, flow } = await fresh();
  const { user, active } = await paidAndActive(flow, leads, users, "+15125551271"); // Monster, $99 paid, billing running
  const world = fakePaymentsWorld();
  const pending = await pick(flow, leads, user.id, "assist-plus");
  assertEquals([pending.status, pending.planId, pending.dueCents, pending.switchedFrom], ["pending", "assist-plus", 30000, "monster"]);
  assertEquals(pending.previousSubscriptionId, active.subscriptionId);
  const due = world.dues.find((d) => d.dueId === pending.dueId)!;
  assertEquals([due.amountCents, due.memo, due.open], [30000, "Monster Assist+ — upgrade from Monster (the difference)", true], "the due is the $300 difference, not $399");
  world.settle(pending.dueId!);
  const plus = await flow.refresh(user.id);
  assertEquals([plus.planId, plus.status], ["assist-plus", "active"]);
  assertEquals(world.subscriptions.map((s) => [s.externalRef, s.status, s.amountCents]), [[`pm:${user.id}:monster`, "canceled", 9900], [`pm:${user.id}:assist-plus`, "active", 39900]]);
  assertEquals(world.subscriptions[1].firstBillAt, active.nextBillAt, "the new billing keeps the anchor: its first bill is the day the $99 one would have billed (REQ-129)");
  assertEquals(plus.paidThrough, active.paidThrough, "the difference pays the month already paid through");
  assertEquals(world.subscriptions[1].firstAmountCents, proratedCents(39900, plus.paidThrough!), "that bill is $399 for the days past paidThrough");
  assertEquals(plus.nextBillCents, world.subscriptions[1].firstAmountCents);
});

Deno.test("REQ-127 choose-plan — a downgrade charges nothing and refunds nothing: active at once, no due, the old billing canceled and the cheaper one starting the day the old one would have billed", async () => {
  const { users, leads, flow } = await fresh();
  const { user } = await paidAndActive(flow, leads, users, "+15125551272");
  const world = fakePaymentsWorld();
  // up to Monster Assist+ first (REQ-127's upgrade), paid
  const up = await pick(flow, leads, user.id, "assist-plus");
  world.settle(up.dueId!);
  const plus = await flow.refresh(user.id);
  const duesBefore = world.dues.length;
  const plusNext = plus.nextBillAt!;
  // down to Monster: no page, nothing to pay
  const down = await flow.choose(user.id, "monster");
  await leads.idle();
  assertEquals([down.planId, down.status], ["monster", "active"], "the downgrade is the plan at once");
  assertEquals(["dueId" in down, "payUrl" in down && Boolean(down.payUrl)], [false, false], "nothing to pay");
  assertEquals(world.dues.length, duesBefore, "no due raised, nothing refunded");
  assertEquals(down.switchedFrom, "assist-plus");
  const subs = world.subscriptions.map((s) => [s.externalRef, s.status, s.amountCents]);
  assertEquals(subs.filter(([ref]) => ref === `pm:${user.id}:assist-plus`), [[`pm:${user.id}:assist-plus`, "canceled", 39900]], "the $399 billing is canceled");
  const monster = world.subscriptions.filter((s) => s.externalRef === `pm:${user.id}:monster`);
  assertEquals(monster.map((s) => [s.status, s.amountCents]), [["canceled", 9900], ["active", 9900]], "the old $99 billing stays canceled; a new $99 one runs");
  assertEquals(monster[1].firstBillAt, plusNext, "the paid month is kept: the first $99 bill is the day the $399 one would have fallen");
  assertEquals(monster[1].firstAmountCents, proratedCents(9900, down.paidThrough!), "REQ-129 — at $99 for the days past the month already paid");
  assertEquals(down.nextBillAt, plusNext);
  assertEquals(down.subscriptionId, monster[1].subscriptionId);
  // read again: nothing started twice
  const again = await flow.current(user.id);
  assertEquals([again?.planId, again?.status, again?.subscriptionId], ["monster", "active", monster[1].subscriptionId]);
  assertEquals(world.subscriptions.length, 3);
  // the CRM's tier followed, after the reply
  assertEquals(world.customers[0].tier, "Monster");
});

Deno.test("REQ-127 choose-plan — a switch away from a pending pick, or from free, is a fresh first month at full price", async () => {
  const { users, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125551273", email: "ana@roof.test", name: "Ana" });
  const world = fakePaymentsWorld();
  const first = await pick(flow, leads, user.id, "assist"); // pending, never paid
  const switched = await pick(flow, leads, user.id, "assist-plus");
  assertEquals([switched.status, "dueCents" in switched, "switchedFrom" in switched], ["pending", false, false]);
  const due = world.dues.find((d) => d.dueId === switched.dueId)!;
  assertEquals([due.amountCents, due.memo], [39900, "Monster Assist+ — first month"], "a pick nobody paid gives no credit");
  assertEquals(world.dues.find((d) => d.dueId === first.dueId)?.open, true, "the abandoned due stays the operator's to void (REQ-056)");
});

// ---- REQ-129 — the billing anchors to the 1st -----------------------------------------------
// Raphael, 2026-11-02: "subscriptions should charge $399 whenever it happens, then on the 1st of
// the month prorated then every month $399."
Deno.test("REQ-129 choose-plan — the first settled month starts the billing on the 1st of the next month for the days past paidThrough, then the full price every 1st", async () => {
  const { users, leads, flow } = await fresh();
  const { user, active } = await paidAndActive(flow, leads, users, "+15125551291");
  const world = fakePaymentsWorld();
  const sub = world.subscriptions[0];
  const firstOf = firstOfNextMonth(active.activatedAt!);
  assertEquals(active.nextBillAt, firstOf, "the next bill is the 1st");
  assertEquals(new Date(firstOf).getUTCDate(), 1);
  assertEquals(active.paidThrough, addMonth(active.activatedAt!));
  const prorated = proratedCents(9900, active.paidThrough!);
  assertEquals([sub.firstAmountCents, active.nextBillCents], [prorated, prorated], "the first bill is the days past paidThrough at $99's rate");
  // the clock on the 1st: the card is charged what the first bill was for, and the bill after is the full month
  world.bill(firstOf);
  const billed = await flow.current(user.id);
  assertEquals(billed?.nextBillAt, addMonth(firstOf), "the next 1st");
  assertEquals(billed?.nextBillCents, 9900, "the full price from here on");
  // the card gone on the next 1st: the due raised is the full month
  world.dropCard(active.customerId!);
  world.bill(billed!.nextBillAt!);
  const pastDue = await flow.current(user.id);
  assertEquals(pastDue?.status, "past_due");
  assertEquals(world.dues[world.dues.length - 1].amountCents, 9900);
});

// ---- REQ-131 / REQ-132 — Alex, 2026-11-02: the gateway approved his $99 at 15:53:22, he was back on
// /plan/return at 15:53:28, the CRM's deferred settlement landed at 15:53:55 — the one refresh said
// "still open", nothing ever asked again, and three re-picks buried the paid pick under a $399 due.
// Raphael: "figure out why the hell it never logged Alex's payment" / "fix it."

Deno.test("REQ-131 choose-plan — a due paid while nobody presses anything activates the plan by the sweep: the watch minted with the page sees it settled, the CRM hears the tier and the team the payment", async () => {
  const { users, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125551310", email: "alex@a2z.test", name: "Alex" });
  const pending = await pick(flow, leads, user.id, "monster");
  assertEquals(pending.status, "pending");
  const world = fakePaymentsWorld();
  world.settle(pending.dueId!); // the card landed; the receipt tab was closed — no /plan/return, no refresh
  assertEquals((await flow.current(user.id))?.status, "pending", "reading the plan asks nothing (as before)");
  await leads.drain(); // the minute sweep
  await leads.idle();
  const active = (await flow.current(user.id))!;
  assertEquals([active.planId, active.status, active.dueId, typeof active.activatedAt], ["monster", "active", pending.dueId, "string"]);
  assertEquals(world.customers.find((c) => c.externalRef === `pm:${user.id}`)?.tier, "Monster", "the tier followed, by the sweep");
  assertEquals(world.subscriptions.length, 1, "the billing started on the read");
});

Deno.test("REQ-131 choose-plan — an unpaid due keeps its watch waiting (backoff, never an error) and the plan pending", async () => {
  const { users, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125551311", email: "w@roof.test", name: "Wai" });
  const pending = await pick(flow, leads, user.id, "monster");
  const r = await leads.drain();
  assertEquals([r.landed, r.deferred, r.waiting], [0, 0, 1], "the watch waits — not a failure");
  assertEquals((await flow.current(user.id))?.status, "pending");
  assertEquals((await flow.current(user.id))?.dueId, pending.dueId);
});

Deno.test("REQ-131 choose-plan — Alex: the paid pick buried under a later unpaid first-month due is restored active by a watch on the paid due, and the upgrade then charges the difference ($300), never $399", async () => {
  const { users, plans, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15408303528", email: "a2z@landscape.test", name: "Alexander" });
  const monster = await pick(flow, leads, user.id, "monster");
  const world = fakePaymentsWorld();
  world.settle(monster.dueId!); // $99 approved
  // the bug as it was: the re-picks replaced the record with a $399 first pick, its own due, the paid one orphaned
  await plans.put(chosen(user.id, "assist-plus", new Date().toISOString(), { merchant: "primary", customerId: monster.customerId, dueId: "due-399-orphan", payUrl: "http://crm/pay?due=due-399-orphan" }));
  assertEquals((await plans.get(user.id))?.dueId, "due-399-orphan");
  // the repair is the same code path: a watch on the paid due (what POST /admin/users/:id/settle-watch enqueues)
  await leads.enqueueSettleWatch(user.id, chosen(user.id, "monster", monster.chosenAt, { merchant: "primary", customerId: monster.customerId, dueId: monster.dueId }));
  await leads.idle();
  const restored = (await flow.current(user.id))!;
  assertEquals([restored.planId, restored.status, restored.dueId, restored.customerId], ["monster", "active", monster.dueId, monster.customerId], "the plan the $99 paid for");
  // now the upgrade: the difference, from Monster
  const up = await pick(flow, leads, user.id, "assist-plus");
  assertEquals([up.planId, up.status, up.dueCents, up.switchedFrom], ["assist-plus", "pending", 30000, "monster"]);
  const due = world.dues.find((d) => d.dueId === up.dueId)!;
  assertEquals([due.amountCents, due.memo], [30000, "Monster Assist+ — upgrade from Monster (the difference)"], "the link says $300");
});

Deno.test("REQ-132 choose-plan — a pick while a pick is pending asks the CRM first: the due paid a moment ago makes it an upgrade from the paid plan (the difference), never a second first pick over it", async () => {
  const { users, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125551320", email: "s@roof.test", name: "Sam" });
  const monster = await pick(flow, leads, user.id, "monster");
  fakePaymentsWorld().settle(monster.dueId!); // paid; the person is back on the cards before anything refreshed
  const up = await pick(flow, leads, user.id, "assist-plus");
  assertEquals([up.planId, up.status, up.dueCents, up.switchedFrom], ["assist-plus", "pending", 30000, "monster"]);
  assertEquals(fakePaymentsWorld().dues.map((d) => d.amountCents), [9900, 30000]);
  // and the watch on the paid due never writes Monster back over the upgrade (the sweep, any time later)
  await leads.drain();
  await leads.idle();
  const still = (await flow.current(user.id))!;
  assertEquals([still.planId, still.status, still.dueCents], ["assist-plus", "pending", 30000]);
});

Deno.test("REQ-131 choose-plan — /plan/return reading the due settled drops the watch: nothing is left on the outbox to look again", async () => {
  const { users, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125551312", email: "d@roof.test", name: "Dee" });
  const pending = await pick(flow, leads, user.id, "monster");
  fakePaymentsWorld().settle(pending.dueId!);
  assertEquals((await flow.refresh(user.id)).status, "active");
  await leads.idle();
  const outbox = new CrmCaptureOutbox();
  assertEquals((await outbox.list()).filter((r) => r.kind === "settle-watch"), []);
});

Deno.test("REQ-132 choose-plan — the same plan picked again while its page is pending is the same page: no second due, no second link", async () => {
  const { users, leads, flow } = await fresh();
  const user = await users.create({ phoneNumber: "+15125551321", email: "t@roof.test", name: "Tam" });
  const first = await pick(flow, leads, user.id, "monster");
  const again = await pick(flow, leads, user.id, "monster");
  assertEquals([again.dueId, again.payUrl, again.chosenAt], [first.dueId, first.payUrl, first.chosenAt]);
  const world = fakePaymentsWorld();
  assertEquals([world.dues.length, world.links.length], [1, 1]);
  // a different plan is a different pick, as before
  const other = await pick(flow, leads, user.id, "assist");
  assert(other.dueId !== first.dueId);
  assertEquals(world.dues.map((d) => d.amountCents), [9900, 19900]);
});
