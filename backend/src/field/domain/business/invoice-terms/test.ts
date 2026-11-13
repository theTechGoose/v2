import { assertEquals } from "#std/assert";
import { netDaysFor, parseNetDays, parseOverheadCents } from "./mod.ts";

// REQ-174 — "subscriptions needs a field to define how long they have to pay the invoice from the
// date sent. it should default to a field on the customer settings that is a number"
Deno.test("REQ-174 netDaysFor — the subscription's own days win (the soonest when a customer has several), else the account's default, else 30", () => {
  assertEquals(netDaysFor([14], 21), 14);
  assertEquals(netDaysFor([14, 7, undefined], 21), 7);
  assertEquals(netDaysFor([undefined, undefined], 21), 21);
  assertEquals(netDaysFor([], 21), 21);
  assertEquals(netDaysFor([], undefined), 30);
  assertEquals(netDaysFor([0], 21), 0);
});

Deno.test("REQ-174 parseNetDays — a whole number of days from 0 to 365; null clears; anything else is refused", () => {
  assertEquals(parseNetDays(14), { ok: true, value: 14 });
  assertEquals(parseNetDays("14"), { ok: true, value: 14 });
  assertEquals(parseNetDays(null), { ok: true, value: undefined });
  assertEquals(parseNetDays(""), { ok: true, value: undefined });
  assertEquals(parseNetDays(undefined).ok, true);
  assertEquals(parseNetDays(-1).ok, false);
  assertEquals(parseNetDays(366).ok, false);
  assertEquals(parseNetDays(1.5).ok, false);
  assertEquals(parseNetDays("soon").ok, false);
});

// REQ-788 — the overhead cost in Settings: a whole number of cents, 0 or more; null clears it
Deno.test("REQ-788 parseOverheadCents — whole cents ≥ 0; null/empty clears; anything else is refused", () => {
  assertEquals(parseOverheadCents(2500), { ok: true, value: 2500 });
  assertEquals(parseOverheadCents("2500"), { ok: true, value: 2500 });
  assertEquals(parseOverheadCents(0), { ok: true, value: 0 });
  assertEquals(parseOverheadCents(null), { ok: true, value: undefined });
  assertEquals(parseOverheadCents(""), { ok: true, value: undefined });
  assertEquals(parseOverheadCents(undefined).ok, true);
  assertEquals(parseOverheadCents(-1).ok, false);
  assertEquals(parseOverheadCents(10.5).ok, false);
  assertEquals(parseOverheadCents("lots").ok, false);
});
