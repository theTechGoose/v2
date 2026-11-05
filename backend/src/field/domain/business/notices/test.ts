/** REQ-171/172 — the field texts and the 9 am rule. */
import { assert, assertEquals } from "#std/assert";
import {
  customerCanceledText,
  customerDeferredText,
  customerTodayText,
  localClock,
  scheduleDue,
  servicesLine,
  validTimezone,
  workerNewTaskText,
} from "./mod.ts";

Deno.test("REQ-171 the texts — worker new task, customer canceled, customer deferred — in both languages, with the business's name", () => {
  const w = workerNewTaskText("en", {
    owner: "Alexander Jerez (A2Z Landscape LLC)",
    type: "Mulch",
    customer: "Ana Torres",
    address: "4601 Dick Pond Rd",
  });
  assert(
    w.includes("Mulch") && w.includes("Ana Torres") &&
      w.includes("4601 Dick Pond Rd") && w.includes("A2Z Landscape LLC"),
    w,
  );
  assert(
    workerNewTaskText("es", {
      owner: "A2Z",
      type: "Mulch",
      customer: "Ana",
      address: "x",
    }).includes("hoy"),
    "Spanish for a worker",
  );
  const c = customerCanceledText("en", {
    business: "A2Z Landscape LLC",
    service: "Lawn",
    date: "2026-11-06",
  });
  assert(
    c.startsWith("A2Z Landscape LLC") && c.includes("Lawn") &&
      /cancel/i.test(c),
    c,
  );
  assert(
    /cancel/i.test(
      customerCanceledText("es", {
        business: "A2Z",
        service: "Césped",
        date: "2026-11-06",
      }),
    ),
    "Spanish cancel",
  );
  const d = customerDeferredText("en", {
    business: "A2Z Landscape LLC",
    service: "Lawn",
    from: "2026-11-06",
    to: "2026-11-07",
  });
  assert(d.includes("Lawn") && d.includes("Nov 7"), d);
  assert(
    customerDeferredText("es", {
      business: "A2Z",
      service: "Césped",
      from: "2026-11-06",
      to: "2026-11-07",
    }).includes("7 nov"),
    "Spanish date",
  );
  const today = customerTodayText("en", {
    business: "A2Z Landscape LLC",
    services: "Lawn, Edging",
  });
  assert(today.includes("today") && today.includes("Lawn, Edging"), today);
  assert(
    customerTodayText("es", { business: "A2Z", services: "Césped" }).includes(
      "hoy",
    ),
    "Spanish today",
  );
  assertEquals(servicesLine(["Lawn", "Edging", "Lawn"]), "Lawn, Edging");
});

Deno.test("REQ-172 scheduleDue — 09:00 local in the business's zone, once a day; a bad zone falls back", () => {
  const at = new Date("2026-11-06T14:05:00Z"); // 09:05 New York (EST), 04:05 Honolulu, 06:05 Los Angeles
  assertEquals(localClock("America/New_York", at), {
    date: "2026-11-06",
    hour: 9,
    minute: 5,
  });
  assertEquals(scheduleDue({ tz: "America/New_York", now: at }), "2026-11-06");
  assertEquals(
    scheduleDue({ tz: "America/New_York", now: at, sentForDate: "2026-11-06" }),
    null,
    "already sent today",
  );
  assertEquals(
    scheduleDue({ tz: "America/New_York", now: at, sentForDate: "2026-11-05" }),
    "2026-11-06",
    "yesterday's send does not count",
  );
  assertEquals(
    scheduleDue({ tz: "Pacific/Honolulu", now: at }),
    null,
    "not 9 yet in Honolulu",
  );
  assertEquals(scheduleDue({ tz: "America/Los_Angeles", now: at }), null);
  assertEquals(
    scheduleDue({
      tz: "America/New_York",
      now: new Date("2026-11-06T13:59:00Z"),
    }),
    null,
    "08:59 New York",
  );
  assertEquals(
    scheduleDue({
      tz: "America/New_York",
      now: new Date("2026-11-07T03:30:00Z"),
    }),
    "2026-11-06",
    "22:30 New York is still the 6th, and late is still due",
  );
  assertEquals(validTimezone("America/Chicago"), "America/Chicago");
  assertEquals(validTimezone("Mars/Olympus"), undefined);
  assertEquals(validTimezone(""), undefined);
  assertEquals(validTimezone(42), undefined);
});
