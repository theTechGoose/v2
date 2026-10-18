/**
 * REQ-081 — Raphael, 2026-10-16: "take this mock … make it real at /landing2 and make sure all
 * aspects of the page are working." The demo booking on that page (demo or call, a day, a time,
 * name, cell, email or "no email — call me", trade) posts a request the backend must read
 * strictly: a malformed request is refused by field, a good one is normalised (E.164 phone,
 * trimmed text, the day as a date, the slot from the one list), and from it come the two
 * messages the page promises — "Te confirmamos por texto" to the person, the booking to the team.
 */
import { assertEquals, assertMatch, assertThrows } from "#std/assert";
import {
  DEMO_SLOTS,
  demoConfirmationSms,
  demoDayLabel,
  DemoRequestInvalid,
  demoTeamEmail,
  parseDemoRequest,
} from "./mod.ts";

const NOW = new Date("2026-10-16T15:00:00Z");
const good = {
  mode: "demo",
  name: "  José García ",
  phone: "(512) 555-0199",
  email: "jose@tunegocio.com",
  trade: "Pintura",
  day: "2026-10-17",
  slot: "11:00 AM",
  lang: "es",
};

Deno.test("REQ-081 parseDemoRequest — a good request is normalised: E.164 phone, trimmed text, the day, the slot, the language", () => {
  const r = parseDemoRequest(good, NOW);
  assertEquals(r, {
    mode: "demo",
    name: "José García",
    phone: "+15125550199",
    email: "jose@tunegocio.com",
    trade: "Pintura",
    day: "2026-10-17",
    slot: "11:00 AM",
    lang: "es",
  });
});

Deno.test("REQ-081 parseDemoRequest — a call needs no email; a demo needs one unless the person said they have none", () => {
  const call = parseDemoRequest({ ...good, mode: "call", email: "" }, NOW);
  assertEquals(call.mode, "call");
  assertEquals(call.email, "");
  const noEmail = parseDemoRequest({ ...good, email: "", noEmail: true }, NOW);
  assertEquals(noEmail.email, "");
  const err = assertThrows(
    () => parseDemoRequest({ ...good, email: "" }, NOW),
    DemoRequestInvalid,
  );
  assertEquals(err.field, "email");
});

Deno.test("REQ-081 parseDemoRequest — every malformed field is refused by name", () => {
  const field = (input: unknown) =>
    assertThrows(() => parseDemoRequest(input, NOW), DemoRequestInvalid).field;
  assertEquals(field({ ...good, mode: "visit" }), "mode");
  assertEquals(field({ ...good, name: "   " }), "name");
  assertEquals(field({ ...good, name: "x".repeat(121) }), "name");
  assertEquals(field({ ...good, phone: "12345" }), "phone");
  assertEquals(field({ ...good, phone: "" }), "phone");
  assertEquals(field({ ...good, email: "not-an-email" }), "email");
  assertEquals(field({ ...good, day: "17/10/2026" }), "day");
  assertEquals(field({ ...good, day: "2026-02-30" }), "day");
  assertEquals(field({ ...good, day: "2026-10-15" }), "day"); // yesterday
  assertEquals(field({ ...good, day: "2027-03-01" }), "day"); // past the 90-day window
  assertEquals(field({ ...good, slot: "11:30 AM" }), "slot");
  assertEquals(field({ ...good, trade: "x".repeat(121) }), "trade");
  assertEquals(field({ ...good, lang: "fr" }), "lang");
  assertEquals(field("nope"), "body");
  assertEquals(field({}), "mode");
});

Deno.test("REQ-081 DEMO_SLOTS — the twelve hours the page offers, 9 AM to 8 PM Eastern", () => {
  assertEquals(DEMO_SLOTS.length, 12);
  assertEquals(DEMO_SLOTS[0], "9:00 AM");
  assertEquals(DEMO_SLOTS[11], "8:00 PM");
});

Deno.test("REQ-081 demoDayLabel — the day as the page shows it, in either language", () => {
  assertEquals(demoDayLabel("2026-10-17", "es"), "Sáb 17 Oct");
  assertEquals(demoDayLabel("2026-10-17", "en"), "Sat 17 Oct");
  assertEquals(demoDayLabel("2026-12-01", "es"), "Mar 1 Dic");
});

Deno.test("REQ-081 demoConfirmationSms — the text the person gets names what they booked, when, and the line to call, in their language", () => {
  const es = demoConfirmationSms(parseDemoRequest(good, NOW));
  assertMatch(es, /DocuMonster/);
  assertMatch(es, /Demo de 15 min/);
  assertMatch(es, /Sáb 17 Oct/);
  assertMatch(es, /11:00 AM/);
  assertMatch(es, /hora del Este/);
  assertMatch(es, /855-362-8666/);
  const en = demoConfirmationSms(
    parseDemoRequest({ ...good, mode: "call", lang: "en" }, NOW),
  );
  assertMatch(en, /Phone call/);
  assertMatch(en, /Sat 17 Oct/);
  assertMatch(en, /Eastern/);
  assertMatch(en, /855-362-8666/);
});

Deno.test("REQ-081 demoTeamEmail — the team's email carries every field of the booking, escaped", () => {
  const mail = demoTeamEmail(
    parseDemoRequest({ ...good, name: "José <García>", trade: "" }, NOW),
  );
  assertMatch(mail.subject, /^\[demo\] /);
  assertMatch(mail.subject, /2026-10-17 11:00 AM/);
  assertMatch(mail.htmlBody, /José &lt;García&gt;/);
  assertMatch(mail.htmlBody, /\+15125550199/);
  assertMatch(mail.htmlBody, /jose@tunegocio\.com/);
  assertMatch(mail.htmlBody, /15-min demo/);
  assertMatch(mail.htmlBody, /Sat 17 Oct/);
  assertMatch(mail.htmlBody, /Spanish/); // the language the person wrote in
  assertMatch(mail.htmlBody, /Trade:<\/strong> —/); // an empty trade is shown as none, never hidden
});
