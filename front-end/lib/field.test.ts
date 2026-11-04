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
