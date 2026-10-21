// REQ-054 — the plan a person picks: free, or a paid plan that is pending until the first month's
// due settles on the CRM's pay page, then active. Pure rules, no I/O.
import { assertEquals, assertThrows } from "#std/assert";
import type { UserPlan } from "@users/dto/plan.ts";
import {
  addMonth,
  chosen,
  customerNameFor,
  LEAD_TIER,
  merchantOf,
  tierFor,
  UNNAMED_CUSTOMER,
  externalRefFor,
  firstMonthMemo,
  isOneTime,
  isSelectable,
  monthLabel,
  monthlyMemo,
  pickBackOf,
  planOf,
  RETURN_LABEL,
  returnUrlFor,
  SELECTABLE_PLAN_IDS,
  settle,
  subscriptionRefFor,
  type SubscriptionView,
  withSubscription,
} from "./mod.ts";
import { isPreparing, minted, payLinkFailed, samePick } from "./mod.ts"; // REQ-106

const NOW = "2026-10-01T15:00:00.000Z";
const LATER = "2026-10-01T15:05:00.000Z";

Deno.test("REQ-054 + REQ-064 plan — the selectable plans are the public monthly ones (free, monster, assist) plus the hidden one-time test plan; projects is custom and not pickable", () => {
  assertEquals([...SELECTABLE_PLAN_IDS], ["free", "monster", "assist", "test"]);
  assertEquals(isSelectable("free"), true);
  assertEquals(isSelectable("projects"), false);
  assertEquals(isSelectable("assist-plus"), false);
  assertEquals(isSelectable(""), false);
});

Deno.test("REQ-054 plan — a plan's price and name come from the one pricing module", () => {
  assertEquals(planOf("free").priceCents, 0);
  assertEquals(planOf("monster").priceCents, 9900);
  assertEquals(planOf("assist").priceCents, 19900);
  assertEquals(planOf("monster").name, "Monster");
  assertThrows(() => planOf("projects"), Error, "plan-unknown");
});

Deno.test("REQ-054 plan — the first month's due names the plan", () => {
  assertEquals(firstMonthMemo(planOf("monster")), "Monster — first month");
  assertEquals(firstMonthMemo(planOf("assist")), "Monster Assist — first month");
});

Deno.test("REQ-054 plan — the CRM customer is the business, else the person (REQ-062: never the email)", () => {
  const user = { id: "u1", email: "a@b.test", name: "Ana" };
  assertEquals(customerNameFor(user, { businessName: "Ana Roofing" }), "Ana Roofing");
  assertEquals(customerNameFor(user, { businessName: "  " }), "Ana");
  assertEquals(customerNameFor({ ...user, name: "" }, null), UNNAMED_CUSTOMER);
});

Deno.test("REQ-054 plan — free is free, a paid pick is pending until its due settles, then active", () => {
  const free = chosen("u1", "free", NOW);
  assertEquals(free, { userId: "u1", planId: "free", status: "free", chosenAt: NOW, updatedAt: NOW });

  const pending = chosen("u1", "monster", NOW, { customerId: "c1", dueId: "d1", payUrl: "https://pay/x", merchant: "primary" });
  assertEquals(pending.status, "pending");
  assertEquals(pending.planId, "monster");
  assertEquals(pending.dueId, "d1");
  assertEquals(pending.payUrl, "https://pay/x");

  // the due is still open: nothing changes, not even the timestamp
  assertEquals(settle(pending, true, LATER), pending);
  // the due settled: active, stamped
  const active = settle(pending, false, LATER);
  assertEquals(active.status, "active");
  assertEquals(active.activatedAt, LATER);
  assertEquals(active.updatedAt, LATER);
  // settling again is a no-op
  assertEquals(settle(active, false, "2026-10-02T00:00:00.000Z"), active);
  // a free plan has no due to settle
  assertEquals(settle(free, false, LATER), free);
});

Deno.test("REQ-054 plan — a paid pick without the CRM's customer, due and pay page is refused", () => {
  assertThrows(() => chosen("u1", "monster", NOW), Error, "pay-link-missing");
});

Deno.test("REQ-058 plan — a brand-new account's CRM customer is the unnamed one (REQ-062) until onboarding brings a name; the phone is the record's key, not its name", () => {
  assertEquals(customerNameFor({ phoneNumber: "+15125550101" }, null), UNNAMED_CUSTOMER);
  assertEquals(customerNameFor({ name: "Ana", phoneNumber: "+15125550101" }, null), "Ana");
  assertEquals(customerNameFor({ name: "Ana", phoneNumber: "+15125550101" }, { businessName: "Ana Roofing" }), "Ana Roofing");
  assertEquals(customerNameFor({}, null), UNNAMED_CUSTOMER);
});

Deno.test("REQ-058 plan — the account's ref on the CRM customer is pm:<userId>", () => {
  assertEquals(externalRefFor("u-1"), "pm:u-1");
});

Deno.test("REQ-059 plan — the return address is the app's /plan/return naming the due and the page the pick came from, whatever slash the origin ends with", () => {
  assertEquals(returnUrlFor("http://localhost:5280", "due-1", "/settings"), "http://localhost:5280/plan/return?due=due-1&back=%2Fsettings");
  assertEquals(returnUrlFor("https://app.documonster.com/", "a b", "/welcome"), "https://app.documonster.com/plan/return?due=a+b&back=%2Fwelcome");
  assertEquals(RETURN_LABEL, "DocuMonster");
});

Deno.test("REQ-059 plan — a pick comes back only to the pages that show the cards; anything else is settings", () => {
  assertEquals(pickBackOf("/welcome"), "/welcome");
  assertEquals(pickBackOf("/settings"), "/settings");
  assertEquals(pickBackOf("https://evil.example/"), "/settings");
  assertEquals(pickBackOf(undefined), "/settings");
});

// REQ-061 — monthly billing: the CRM's subscription behind an active plan

const ACTIVE = (): UserPlan => ({ userId: "u-1", planId: "monster", status: "active", chosenAt: "2026-10-02T00:00:00.000Z", activatedAt: "2026-10-02T01:11:06.740Z", customerId: "c-1", dueId: "d-1", payUrl: "http://crm/first", updatedAt: "2026-10-02T01:11:06.740Z" });
const SUB = (over: Partial<SubscriptionView> = {}) => ({ subscriptionId: "s-1", status: "active" as const, nextBillAt: "2026-11-02T01:11:06.740Z", cardBrand: "visa", cardLast4: "1111", payUrl: "", ...over });

Deno.test("REQ-061 plan — a calendar month later, same time; a short month lands on its last day; the month is named", () => {
  assertEquals(addMonth("2026-10-02T01:11:06.740Z"), "2026-11-02T01:11:06.740Z");
  assertEquals(addMonth("2026-01-31T00:00:00.000Z"), "2026-02-28T00:00:00.000Z");
  assertEquals(addMonth("2026-12-15T12:00:00.000Z"), "2027-01-15T12:00:00.000Z");
  assertEquals(monthLabel("2026-11-02T01:11:06.740Z"), "November 2026");
  assertEquals(subscriptionRefFor("u-1", "monster"), "pm:u-1:monster");
  assertEquals(monthlyMemo(planOf("monster")), "Monster", "the CRM appends the month");
});

Deno.test("REQ-061 plan — what the billing says is the plan's state: current carries the next bill and the card", () => {
  const plan = ACTIVE();
  const next = withSubscription(plan, SUB(), "2026-10-02T02:00:00.000Z");
  assertEquals(next.status, "active");
  assertEquals([next.subscriptionId, next.nextBillAt, next.cardBrand, next.cardLast4], ["s-1", "2026-11-02T01:11:06.740Z", "visa", "1111"]);
  assertEquals(next.payUrl, "", "nothing to pay while current: the first month's page is done with");
  assertEquals(next.updatedAt, "2026-10-02T02:00:00.000Z");
  assertEquals(withSubscription(next, SUB(), "2026-10-02T03:00:00.000Z"), next, "nothing new: the same record, not a rewrite");
  assertEquals(withSubscription(plan, null, "2026-10-02T02:00:00.000Z"), plan, "nothing to say: the plan as it is");
});

Deno.test("REQ-061 plan — a month the CRM could not collect is PAST DUE with that month's pay page; canceled on the CRM drops to free", () => {
  const plan = withSubscription(ACTIVE(), SUB(), "2026-10-02T02:00:00.000Z");
  const pastDue = withSubscription(plan, SUB({ status: "past_due", payUrl: "http://crm/ui/payments/charge?customer=c&due=d-nov" }), "2026-11-02T02:00:00.000Z");
  assertEquals(pastDue.status, "past_due");
  assertEquals(pastDue.payUrl, "http://crm/ui/payments/charge?customer=c&due=d-nov");
  assertEquals(pastDue.planId, "monster", "still the plan");
  const back = withSubscription(pastDue, SUB({ nextBillAt: "2026-12-02T01:11:06.740Z" }), "2026-11-03T00:00:00.000Z");
  assertEquals([back.status, back.nextBillAt], ["active", "2026-12-02T01:11:06.740Z"]);
  const gone = withSubscription(back, SUB({ status: "canceled" }), "2026-11-20T00:00:00.000Z");
  assertEquals(gone.status, "free");
  assertEquals([gone.subscriptionId, gone.nextBillAt, gone.cardLast4], [undefined, undefined, undefined]);
  assertEquals(withSubscription(gone, SUB({ status: "canceled" }), "2026-11-21T00:00:00.000Z"), gone, "already free");
});

Deno.test("REQ-061 plan — a paid pick over a paid plan remembers the billing it replaces", () => {
  const link = { customerId: "c-1", dueId: "d-2", payUrl: "http://crm/second", merchant: "primary" };
  assertEquals(chosen("u-1", "assist", "2026-11-01T00:00:00.000Z", link, "s-1").previousSubscriptionId, "s-1");
  assertEquals("previousSubscriptionId" in chosen("u-1", "assist", "2026-11-01T00:00:00.000Z", link), false);
});

// REQ-062 — "customer phone number in quickbase as 'unknown dragon mcdragonson'" / "all financial
// info and guest info updated in quickbase with tier"
Deno.test("REQ-062 plan — a person who has given no name is 'unknown dragon mcdragonson' on the CRM; a business or a name takes over", () => {
  assertEquals(UNNAMED_CUSTOMER, "unknown dragon mcdragonson");
  assertEquals(customerNameFor({ phoneNumber: "+15125550100" }, null), UNNAMED_CUSTOMER);
  assertEquals(customerNameFor({ email: "rosa@roof.test", phoneNumber: "+15125550100" }, null), UNNAMED_CUSTOMER, "an email is not a name");
  assertEquals(customerNameFor({ name: "  " }, { businessName: "" }), UNNAMED_CUSTOMER);
  assertEquals(customerNameFor({ name: "Rosa" }, null), "Rosa");
  assertEquals(customerNameFor({ name: "Rosa" }, { businessName: "Rosa Roofing" }), "Rosa Roofing");
});

Deno.test("REQ-062 plan — the CRM tier is Lead until a paid plan is current, then the plan's name; a month past due keeps it", () => {
  const base = { userId: "u-1", chosenAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" };
  assertEquals(LEAD_TIER, "Lead");
  assertEquals(tierFor(null), "Lead", "nothing picked yet");
  assertEquals(tierFor({ ...base, planId: "free", status: "free" }), "Free", "REQ-111 — on the free plan: the CRM ladder's Free rung (the first upsell call), the selected plan on the record");
  assertEquals(tierFor({ ...base, planId: "monster", status: "pending" }), "Lead", "not paid yet");
  assertEquals(tierFor({ ...base, planId: "monster", status: "active" }), "Monster");
  assertEquals(tierFor({ ...base, planId: "assist", status: "active" }), "Monster Assist");
  assertEquals(tierFor({ ...base, planId: "monster", status: "past_due" }), "Monster", "still a customer while the month is retried");
});

// REQ-064 — the hidden $1 one-time test tier, and the merchant a pick names
Deno.test("REQ-064 plan — the test tier is selectable, one-time, $1 and never public", () => {
  assertEquals(SELECTABLE_PLAN_IDS.includes("test"), true);
  const plan = planOf("test");
  assertEquals([plan.name, plan.priceCents, plan.period, plan.public], ["Monster Test", 100, "one-time", false]);
  assertEquals(isOneTime(plan), true);
  assertEquals(isOneTime(planOf("monster")), false);
  assertEquals(firstMonthMemo(plan), "Monster Test — one-time test charge", "a one-time charge is not a first month");
  assertEquals(firstMonthMemo(planOf("monster")), "Monster — first month");
});

Deno.test("REQ-064 plan — a paid test tier keeps the CRM tier Lead: a test charge is not a membership", () => {
  const base = { userId: "u-1", chosenAt: NOW, updatedAt: NOW };
  assertEquals(tierFor({ ...base, planId: "test", status: "active" }), LEAD_TIER);
  assertEquals(tierFor({ ...base, planId: "test", status: "pending" }), LEAD_TIER);
});

// REQ-100 — one source of truth: a paid pick's record always carries the account its charge goes
// through; a link without one is not a pay link (REQ-064's "none stored" is retired)
Deno.test("REQ-064/100 plan — a paid pick's record carries the account it was made with, always; a link naming none is refused", () => {
  const link = { customerId: "c-1", dueId: "d-1", payUrl: "http://crm/ui/payments/charge?customer=x&due=d-1&account=primary" };
  assertEquals(chosen("u-1", "test", NOW, { ...link, merchant: "sandbox" }).merchant, "sandbox");
  assertEquals(chosen("u-1", "monster", NOW, { ...link, merchant: "primary" }).merchant, "primary");
  assertThrows(() => chosen("u-1", "monster", NOW, { ...link, merchant: "" }), Error, "pay-link-missing");
  assertEquals("merchant" in chosen("u-1", "free", NOW), false, "free has no charge, so no account");
});

Deno.test("REQ-064 plan — a merchant name is a slug or nothing; anything else is refused by name", () => {
  assertEquals(merchantOf(undefined), "");
  assertEquals(merchantOf(""), "");
  assertEquals(merchantOf("  Alpha-1 "), "alpha-1", "trimmed and lowercased");
  for (const bad of ["bad key", "a/b", "x".repeat(41), 42]) {
    const e = assertThrows(() => merchantOf(bad), Error, "merchant-invalid");
    assertEquals((e as Error & { status?: number }).status, 400);
  }
});

// ---- REQ-106 — Raphael, 2026-10-20: "when i click a plan in the onboarding flow the payment link
// takes FOREVER to load, can we speed it up and keep the exact same result in the crm? i dont care
// if it happens asyncronously … what i care about is that the user experience is good." A paid
// pick is pending from the reply on, with the account decided; the CRM's customer, due and page
// come by the sweep and land on the record; a refusal is read on it; a re-pick is told apart.
Deno.test("REQ-106 plan — a paid pick is pending with its account before the CRM is reached; the page the sweep mints lands on it; a refusal is read on it; a newer pick is told apart", () => {
  const preparing = chosen("u1", "monster", NOW, { merchant: "primary" });
  assertEquals(preparing, { userId: "u1", planId: "monster", status: "pending", chosenAt: NOW, updatedAt: NOW, merchant: "primary" });
  assertEquals(isPreparing(preparing), true);
  // a paid pick still names the account the charge goes through (REQ-100)
  assertThrows(() => chosen("u1", "monster", NOW, { merchant: "" }), Error, "pay-link-missing");
  assertThrows(() => chosen("u1", "monster", NOW), Error, "pay-link-missing");
  // the sweep's result: the same customer, due and page the reply used to carry
  const link = { customerId: "c1", dueId: "d1", payUrl: "https://pay/x", merchant: "primary" };
  const ready = minted(preparing, link, LATER);
  assertEquals(ready, { ...preparing, customerId: "c1", dueId: "d1", payUrl: "https://pay/x", updatedAt: LATER });
  assertEquals(isPreparing(ready), false);
  assertEquals({ ...chosen("u1", "monster", NOW, link), updatedAt: LATER }, ready, "the record a sync pick used to write");
  // the CRM's refusal is read on the record; the sweep's success clears it
  const refused = payLinkFailed(preparing, "merchant-unknown", LATER);
  assertEquals([refused.payLinkError, refused.status, refused.updatedAt, isPreparing(refused)], ["merchant-unknown", "pending", LATER, true]);
  assertEquals(payLinkFailed(preparing, "payments-unavailable", LATER).payLinkError, "payments-unavailable");
  assertEquals(minted(refused, link, LATER).payLinkError, undefined);
  // nothing is being prepared on a free plan, an active one, or a past-due month (its page is the CRM's)
  assertEquals(isPreparing(chosen("u1", "free", NOW)), false);
  assertEquals(isPreparing(settle(ready, false, LATER)), false);
  // the pick the sweep set out to mint is told apart from a newer one
  assertEquals(samePick(preparing, preparing), true);
  assertEquals(samePick(preparing, refused), true, "a refusal on the same pick is still that pick");
  assertEquals(samePick(preparing, chosen("u1", "assist", NOW, { merchant: "primary" })), false);
  assertEquals(samePick(preparing, chosen("u1", "monster", LATER, { merchant: "primary" })), false);
});
