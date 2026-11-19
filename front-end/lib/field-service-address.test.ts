/**
 * REQ-1007 (LOOP-007 q1, q1-93) — Add task (/field/tasks) and New work order
 * (/work-orders) fill the address with the customer's KNOWN service address:
 * the street address on their active repeat visit when the customer record
 * only holds a city ("Myrtle Beach, SC"). A typed address is never overwritten.
 *
 * `knownServiceAddress` does not exist yet; it is reached through the module
 * namespace so the red is the missing behaviour, not a link error.
 */
import { assertEquals } from "@std/assert";
import * as field from "./field.ts";

type Sub = {
  customerId: string;
  address: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};
type KnownServiceAddress = (
  customer: { id: string; address?: string },
  subscriptions: Sub[],
) => string;

function knownServiceAddress(
  customer: { id: string; address?: string },
  subscriptions: Sub[],
): string {
  const fn = (field as unknown as { knownServiceAddress?: KnownServiceAddress })
    .knownServiceAddress;
  if (typeof fn !== "function") {
    throw new Error(
      "front-end/lib/field.ts exports no knownServiceAddress(customer, subscriptions)",
    );
  }
  return fn(customer, subscriptions);
}

const ana = { id: "c-ana", address: "Myrtle Beach, SC" };
const visit = (over: Partial<Sub> = {}): Sub => ({
  customerId: "c-ana",
  address: "1200 N Ocean Blvd, Myrtle Beach, SC",
  active: true,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  ...over,
});

Deno.test("REQ-1007 knownServiceAddress — a city-only customer with a repeat visit at a street address gets the visit's street address", () => {
  assertEquals(
    knownServiceAddress(ana, [visit()]),
    "1200 N Ocean Blvd, Myrtle Beach, SC",
  );
});

Deno.test("REQ-1007 knownServiceAddress — no repeat visit: the customer's own address", () => {
  assertEquals(knownServiceAddress(ana, []), "Myrtle Beach, SC");
});

Deno.test("REQ-1007 knownServiceAddress — another customer's visit and a paused visit are not used", () => {
  assertEquals(
    knownServiceAddress(ana, [
      visit({
        customerId: "c-bob",
        address: "6219 Forestbrook Rd, Myrtle Beach, SC",
      }),
      visit({ active: false }),
    ]),
    "Myrtle Beach, SC",
  );
});

Deno.test("REQ-1007 knownServiceAddress — two active visits: the most recently updated one", () => {
  assertEquals(
    knownServiceAddress(ana, [
      visit({
        address: "9 Old Rd, Myrtle Beach, SC",
        updatedAt: "2026-10-01T10:00:00.000Z",
      }),
      visit({ updatedAt: "2026-11-10T10:00:00.000Z" }),
    ]),
    "1200 N Ocean Blvd, Myrtle Beach, SC",
  );
});

Deno.test("REQ-1007 knownServiceAddress — a customer with no address on file gets the visit's address", () => {
  assertEquals(
    knownServiceAddress({ id: "c-ana" }, [visit()]),
    "1200 N Ocean Blvd, Myrtle Beach, SC",
  );
});

Deno.test("REQ-1007 knownServiceAddress — a customer whose own street address differs from the visit keeps theirs (REQ-340: customer address and service address stay separate)", () => {
  assertEquals(
    knownServiceAddress(
      { id: "c-ana", address: "4601 Dick Pond Rd, Myrtle Beach, SC" },
      [visit()],
    ),
    "4601 Dick Pond Rd, Myrtle Beach, SC",
  );
});

Deno.test("REQ-1007 knownServiceAddress + prefillAddress — a typed address is never overwritten by the known service address", () => {
  const next = { address: knownServiceAddress(ana, [visit()]) };
  assertEquals(
    field.prefillAddress("12 My Own St", undefined, next),
    "12 My Own St",
  );
  assertEquals(
    field.prefillAddress("", undefined, next),
    "1200 N Ocean Blvd, Myrtle Beach, SC",
  );
});
