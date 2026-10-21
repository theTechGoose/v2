/**
 * REQ-108 — Raphael, 2026-10-21, the launch checklist: "Visitors must select a specific day and
 * time, rather than a morning or afternoon window. Offer available times between 8 a.m. and
 * 8 p.m. Eastern Time. Do not allow same-day bookings. The earliest available date must be
 * tomorrow. Collect their name, phone number, and email address. … Ensure the team receives all
 * submitted information, including the selected demo date and time." The parser reads the page's
 * POST strictly: a name, a cell, an email, a day from tomorrow (Eastern) within the window, a time
 * the page offers, the consent (never optional); from the booking come the two messages — the text
 * to the person, the booking to the team with the date and the time on it. REQ-090's call with
 * just a cell is gone: the card books a demo, nothing else.
 */
import { assertEquals, assertMatch, assertThrows } from "#std/assert";
import {
  DEMO_DAY_WINDOW,
  DEMO_TIMES,
  demoTimeLabel,
  upcomingDemoDays,
} from "#demo-booking/mod.ts";
import {
  demoConfirmationSms,
  demoDayLabel,
  DemoRequestInvalid,
  demoSummary,
  demoTeamEmail,
  parseDemoRequest,
} from "./mod.ts";

/** 11 AM Eastern on Sunday 18 Oct 2026 */
const NOW = new Date("2026-10-18T15:00:00Z");
const demo = {
  name: "  José García ",
  phone: "(512) 555-0199",
  email: "jose@tunegocio.com",
  day: "2026-10-20",
  time: "10:30",
  lang: "es",
  consent: true,
};
const field = (input: unknown, now: Date = NOW) =>
  assertThrows(() => parseDemoRequest(input, now), DemoRequestInvalid).field;

Deno.test("REQ-108 parseDemoRequest — a booking is normalised: E.164 phone, trimmed name, the email, the day, the time, the language, the consent", () => {
  assertEquals(parseDemoRequest(demo, NOW), {
    name: "José García",
    phone: "+15125550199",
    email: "jose@tunegocio.com",
    day: "2026-10-20",
    time: "10:30",
    lang: "es",
    consent: true,
  });
});

Deno.test("REQ-108 parseDemoRequest — the name, the cell and the email are all collected: each is refused by name when missing or malformed", () => {
  assertEquals(field({ ...demo, name: "   " }), "name");
  assertEquals(field({ ...demo, name: "x".repeat(121) }), "name");
  assertEquals(field({ ...demo, phone: "12345" }), "phone");
  assertEquals(field({ ...demo, phone: "" }), "phone");
  assertEquals(field({ ...demo, email: "" }), "email"); // collected, never optional
  assertEquals(field({ ...demo, email: "not-an-email" }), "email");
  assertEquals(field({ ...demo, lang: "fr" }), "lang");
  assertEquals(field("nope"), "body");
  assertEquals(field({}), "consent");
});

Deno.test("REQ-108 parseDemoRequest — the consent box is the one field never optional: unticked, absent or anything but true is refused by name", () => {
  assertEquals(field({ ...demo, consent: false }), "consent");
  assertEquals(field({ ...demo, consent: undefined }), "consent");
  assertEquals(field({ ...demo, consent: "true" }), "consent");
  assertEquals(field({ ...demo, consent: 1 }), "consent");
});

Deno.test("REQ-108 parseDemoRequest — no same-day booking: today (Eastern) is refused and tomorrow is the earliest, even late in the Eastern evening; the window's last day is a booking and the day after is refused", () => {
  assertEquals(field({ ...demo, day: "2026-10-18" }), "day"); // today
  assertEquals(field({ ...demo, day: "2026-10-17" }), "day"); // yesterday
  assertEquals(parseDemoRequest({ ...demo, day: "2026-10-19" }, NOW).day, "2026-10-19"); // tomorrow
  // 11:30 PM Eastern on the 18th is already the 19th in UTC: still today in Eastern, so still refused
  const lateEvening = new Date("2026-10-19T03:30:00Z");
  assertEquals(field({ ...demo, day: "2026-10-18" }, lateEvening), "day");
  assertEquals(parseDemoRequest({ ...demo, day: "2026-10-19" }, lateEvening).day, "2026-10-19");
  assertEquals(field({ ...demo, day: "" }), "day");
  assertEquals(field({ ...demo, day: "20/10/2026" }), "day");
  assertEquals(field({ ...demo, day: "2026-02-30" }), "day");
  // the page's days are the backend's: from tomorrow, DEMO_DAY_WINDOW of them (REQ-102)
  const offered = upcomingDemoDays("es", NOW);
  assertEquals(offered.length, DEMO_DAY_WINDOW);
  assertEquals(offered[0].iso, "2026-10-19", "the first day offered is tomorrow, Eastern");
  const sixth = offered[5].iso;
  assertEquals(parseDemoRequest({ ...demo, day: sixth }, NOW).day, sixth);
  const last = offered[offered.length - 1].iso;
  assertEquals(parseDemoRequest({ ...demo, day: last }, NOW).day, last);
  const after = new Date(Date.parse(last) + 86_400_000).toISOString().slice(0, 10);
  assertEquals(field({ ...demo, day: after }), "day");
});

Deno.test("REQ-108 parseDemoRequest — the time is one the page offers: 8:00 AM to 7:30 PM Eastern, every half hour; anything else is refused by name; REQ-090's call with just a cell is no booking", () => {
  assertEquals(DEMO_TIMES.length, 24);
  assertEquals(DEMO_TIMES[0], { id: "08:00", label: "8:00 AM" });
  assertEquals(DEMO_TIMES[1], { id: "08:30", label: "8:30 AM" });
  assertEquals(DEMO_TIMES[8], { id: "12:00", label: "12:00 PM" });
  assertEquals(DEMO_TIMES[9], { id: "12:30", label: "12:30 PM" });
  assertEquals(DEMO_TIMES[23], { id: "19:30", label: "7:30 PM" });
  for (const t of DEMO_TIMES) assertEquals(parseDemoRequest({ ...demo, time: t.id }, NOW).time, t.id);
  assertEquals(field({ ...demo, time: "" }), "time");
  assertEquals(field({ ...demo, time: "morning" }), "time"); // the old windows are no time
  assertEquals(field({ ...demo, time: "07:30" }), "time"); // before 8 AM
  assertEquals(field({ ...demo, time: "20:00" }), "time"); // 8 PM is the close, not a start
  assertEquals(field({ ...demo, time: "10:15" }), "time"); // between the half hours
  assertEquals(field({ ...demo, time: "10:30 AM" }), "time"); // the id is HH:MM, Eastern
  // a cell alone is not a booking any more: the name, then the email, are asked for
  assertEquals(field({ mode: "call", phone: "(512) 555-0199", lang: "es", consent: true }), "name");
  assertEquals(field({ ...demo, email: "", day: "", time: "" }), "email");
});

Deno.test("REQ-108 demoTimeLabel + demoDayLabel — the time and the day as the page and the messages show them, in either language", () => {
  assertEquals(demoTimeLabel("10:30", "es"), "10:30 AM (hora del Este)");
  assertEquals(demoTimeLabel("19:30", "en"), "7:30 PM (Eastern)");
  assertEquals(demoTimeLabel("12:00", "en"), "12:00 PM (Eastern)");
  assertEquals(demoDayLabel("2026-10-17", "es"), "Sáb 17 Oct");
  assertEquals(demoDayLabel("2026-10-17", "en"), "Sat 17 Oct");
  assertEquals(demoDayLabel("2026-12-01", "es"), "Mar 1 Dic");
});

Deno.test("REQ-108 demoSummary + demoConfirmationSms — the booking names the day and the time; the text goes to the person in their language, by name, with the support number", () => {
  assertEquals(
    demoSummary(parseDemoRequest(demo, NOW)),
    "Demo de 15 min · Mar 20 Oct · 10:30 AM (hora del Este)",
  );
  assertEquals(
    demoSummary(parseDemoRequest({ ...demo, lang: "en", time: "19:30" }, NOW)),
    "15-min demo · Tue 20 Oct · 7:30 PM (Eastern)",
  );
  const es = demoConfirmationSms(parseDemoRequest(demo, NOW));
  assertMatch(
    es,
    /^DocuMonster: ¡listo, José García! Te llamamos — Demo de 15 min · Mar 20 Oct · 10:30 AM \(hora del Este\)\./,
  );
  assertMatch(es, /855-362-8666/);
  const en = demoConfirmationSms(parseDemoRequest({ ...demo, lang: "en" }, NOW));
  assertMatch(
    en,
    /^DocuMonster: you're booked, José García! We'll call you — 15-min demo · Tue 20 Oct · 10:30 AM \(Eastern\)\./,
  );
  assertMatch(en, /855-362-8666/);
});

Deno.test("REQ-108 demoTeamEmail — the team's email carries every field of the booking, escaped, the date and the time on it, the consent on record", () => {
  const mail = demoTeamEmail(
    parseDemoRequest({ ...demo, name: "José <García>", time: "14:00" }, NOW),
  );
  assertMatch(mail.subject, /^\[demo\] José <García> — 2026-10-20 2:00 PM Eastern$/);
  assertMatch(mail.htmlBody, /15-min demo/);
  assertMatch(mail.htmlBody, /When:<\/strong> Tue 20 Oct \(2026-10-20\) · 2:00 PM Eastern/);
  assertMatch(mail.htmlBody, /Name:<\/strong> José &lt;García&gt;/);
  assertMatch(mail.htmlBody, /Phone:<\/strong> \+15125550199/);
  assertMatch(mail.htmlBody, /Email:<\/strong> jose@tunegocio\.com/);
  assertMatch(mail.htmlBody, /Consent:<\/strong> yes/);
  assertMatch(mail.htmlBody, /Language:<\/strong> Spanish/);
});
