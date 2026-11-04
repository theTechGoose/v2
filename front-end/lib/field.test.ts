/** REQ-144 — picking a customer fills the service address, never over a typed one. */
import { assertEquals } from "@std/assert";
import { prefillAddress } from "./field.ts";

const ana = { address: "4601 Dick Pond Rd, Myrtle Beach, SC" };
const bob = { address: "6219 Forestbrook Rd, Myrtle Beach, SC" };
const none = { address: undefined };

Deno.test("REQ-144 prefillAddress — an empty box takes the pick's address", () => {
  assertEquals(prefillAddress("", undefined, ana), ana.address);
  assertEquals(prefillAddress("   ", undefined, ana), ana.address);
});

Deno.test("REQ-144 prefillAddress — the previous pick's address is replaced by the next pick's", () => {
  assertEquals(prefillAddress(ana.address, ana, bob), bob.address);
});

Deno.test("REQ-144 prefillAddress — a typed address stays", () => {
  assertEquals(prefillAddress("12 My Own St", ana, bob), "12 My Own St");
  assertEquals(prefillAddress("12 My Own St", undefined, bob), "12 My Own St");
});

Deno.test("REQ-144 prefillAddress — a customer with no address on file leaves the box alone", () => {
  assertEquals(prefillAddress("", undefined, none), "");
  assertEquals(prefillAddress(ana.address, ana, none), ana.address);
  assertEquals(prefillAddress("", undefined, undefined), "");
});

import { perVisitCents, subscriptionsByCustomer } from "./field.ts";

const sub = (
  id: string,
  customerId: string,
  prices: number[],
  createdAt: string,
) => ({
  id,
  customerId,
  createdAt,
  items: prices.map((priceCents, i) => ({
    taskTypeId: `t${i}`,
    taskTypeName: `T${i}`,
    priceCents,
  })),
});

Deno.test("REQ-145 subscriptionsByCustomer — grouped by customer, creation order kept, a customer with none is absent", () => {
  const m = subscriptionsByCustomer([
    sub("s2", "ana", [6500], "2026-11-02T00:00:00Z"),
    sub("s3", "bob", [7500, 4000], "2026-11-03T00:00:00Z"),
    sub("s1", "ana", [6000], "2026-11-01T00:00:00Z"),
  ]);
  assertEquals(m.get("ana")?.map((s) => s.id), ["s1", "s2"]);
  assertEquals(m.get("bob")?.map((s) => s.id), ["s3"]);
  assertEquals(m.get("camila"), undefined);
});

Deno.test("REQ-145 perVisitCents — the items' sum", () => {
  assertEquals(perVisitCents(sub("s3", "bob", [7500, 4000], "")), 11500);
  assertEquals(perVisitCents(sub("s0", "bob", [], "")), 0);
});
