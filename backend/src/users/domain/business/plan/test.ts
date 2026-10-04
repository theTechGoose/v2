// REQ-054 — the plan a person picks: free, or a paid plan that is pending until the first month's
// due settles on the CRM's pay page, then active. Pure rules, no I/O.
import { assertEquals, assertThrows } from "#std/assert";
import {
  chosen,
  customerNameFor,
  firstMonthMemo,
  isSelectable,
  planOf,
  SELECTABLE_PLAN_IDS,
  settle,
} from "./mod.ts";

const NOW = "2026-10-01T15:00:00.000Z";
const LATER = "2026-10-01T15:05:00.000Z";

Deno.test("REQ-054 plan — the selectable plans are the public monthly ones: free, monster, assist; projects is custom and not pickable", () => {
  assertEquals([...SELECTABLE_PLAN_IDS], ["free", "monster", "assist"]);
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

Deno.test("REQ-054 plan — the CRM customer is the business, else the person, else the email", () => {
  const user = { id: "u1", email: "a@b.test", name: "Ana" };
  assertEquals(customerNameFor(user, { businessName: "Ana Roofing" }), "Ana Roofing");
  assertEquals(customerNameFor(user, { businessName: "  " }), "Ana");
  assertEquals(customerNameFor({ ...user, name: "" }, null), "a@b.test");
});

Deno.test("REQ-054 plan — free is free, a paid pick is pending until its due settles, then active", () => {
  const free = chosen("u1", "free", NOW);
  assertEquals(free, { userId: "u1", planId: "free", status: "free", chosenAt: NOW, updatedAt: NOW });

  const pending = chosen("u1", "monster", NOW, { customerId: "c1", dueId: "d1", payUrl: "https://pay/x" });
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
