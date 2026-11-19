/** REQ-144 — picking a customer fills the service address, never over a typed one. */
import { assertEquals } from "@std/assert";
import { customerOptions, prefillAddress, workerScreenLang } from "./field.ts";

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

Deno.test("REQ-152 customerOptions — name is the label, the address on file is the hint; no address, no hint", () => {
  assertEquals(
    customerOptions([
      { id: "c1", name: "Ana Torres", address: ana.address },
      { id: "c2", name: "Nadia Noaddress" },
      { id: "c3", name: "Bob Marshall", address: "  " },
    ]),
    [
      { id: "c1", label: "Ana Torres", hint: ana.address },
      { id: "c2", label: "Nadia Noaddress" },
      { id: "c3", label: "Bob Marshall" },
    ],
  );
});

Deno.test("REQ-285 workerScreenLang — once signed in, the screen takes the worker's language", () => {
  assertEquals(workerScreenLang({ language: "es" }, false), "es");
  assertEquals(workerScreenLang({ language: "en" }, false), "en");
});

Deno.test("REQ-285 workerScreenLang — a language the person chose (the EN/ES switch, or ?lang= in the address) is kept", () => {
  assertEquals(workerScreenLang({ language: "es" }, true), null);
});

Deno.test("REQ-285 workerScreenLang — nobody signed in, or no language answered: nothing changes", () => {
  assertEquals(workerScreenLang(null, false), null);
  assertEquals(workerScreenLang({}, false), null);
  assertEquals(workerScreenLang({ language: "fr" }, false), null);
});

// REQ-1014 (LOOP-007 q1, q1-99) — the /field/workers Away row's date text. It printed the
// absence's raw "2026-11-26"; the field screens all read a day as fmtDay's "Thu, Nov 26".
// fmtDayRange(from, to, lang) is the pure helper the row renders.
import * as fieldLib from "./field.ts";
type DayRange = (from: string, to: string, lang: "en" | "es") => string;
const dayRange = (): DayRange => {
  const f = (fieldLib as Record<string, unknown>).fmtDayRange;
  assertEquals(typeof f, "function", "field.ts exports fmtDayRange(from, to, lang)");
  return f as DayRange;
};

Deno.test("REQ-1014 fmtDayRange — one day reads 'Thu, Nov 26', not '2026-11-26'", () => {
  assertEquals(dayRange()("2026-11-26", "2026-11-26", "en"), "Thu, Nov 26");
});

Deno.test("REQ-1014 fmtDayRange — a two-day range reads 'Thu, Nov 26 → Fri, Nov 27'", () => {
  assertEquals(
    dayRange()("2026-11-26", "2026-11-27", "en"),
    "Thu, Nov 26 → Fri, Nov 27",
  );
});

Deno.test("REQ-1014 fmtDayRange — Spanish is localized like fmtDay and never ISO", () => {
  const es = dayRange()("2026-11-26", "2026-11-27", "es");
  assertEquals(
    es,
    `${fieldLib.fmtDay("2026-11-26", "es")} → ${fieldLib.fmtDay("2026-11-27", "es")}`,
  );
  assertEquals(/\d{4}-\d{2}-\d{2}/.test(es), false);
});
