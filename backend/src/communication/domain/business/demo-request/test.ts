/**
 * REQ-090 — Raphael, 2026-10-18, the v3 landing: "the demo is one card — Llámenme with just a cell
 * books a call as soon as possible, or the person picks one of five days from tomorrow and a
 * morning or afternoon window, name, cell and email, with its own consent box — and the backend
 * takes that booking and keeps the consent on record." The parser reads the page's POST strictly:
 * a call needs nothing but the cell and the ticked box; a demo needs a name, a day and a window;
 * the consent is the one field never optional; and from the booking come the two messages the
 * page promises — "Te confirmamos por texto" to the person, the booking to the team, consent on it.
 */
import { assertEquals, assertMatch, assertThrows } from "#std/assert";
import {
  DEMO_SLOTS,
  demoConfirmationSms,
  demoDayLabel,
  DemoRequestInvalid,
  demoSlotLabel,
  demoSummary,
  demoTeamEmail,
  parseDemoRequest,
} from "./mod.ts";

const NOW = new Date("2026-10-18T15:00:00Z");
const demo = {
  mode: "demo",
  name: "  José García ",
  phone: "(512) 555-0199",
  email: "jose@tunegocio.com",
  day: "2026-10-20",
  slot: "morning",
  lang: "es",
  consent: true,
};
const call = {
  mode: "call",
  phone: "(512) 555-0199",
  lang: "es",
  consent: true,
};

Deno.test("REQ-090 parseDemoRequest — a demo is normalised: E.164 phone, trimmed name, the day, the window, the language, the consent", () => {
  assertEquals(parseDemoRequest(demo, NOW), {
    mode: "demo",
    name: "José García",
    phone: "+15125550199",
    email: "jose@tunegocio.com",
    day: "2026-10-20",
    slot: "morning",
    lang: "es",
    consent: true,
  });
});

Deno.test("REQ-090 parseDemoRequest — a call with just a cell is a booking as soon as possible: no name, no email, no day, no window", () => {
  assertEquals(parseDemoRequest(call, NOW), {
    mode: "call",
    name: "",
    phone: "+15125550199",
    email: "",
    day: "",
    slot: "",
    lang: "es",
    consent: true,
  });
  // the page sends the empty fields along; they are read as absent
  const r = parseDemoRequest(
    { ...call, name: "", email: "", day: "", slot: "" },
    NOW,
  );
  assertEquals(r.day, "");
  assertEquals(r.slot, "");
  // a demo's email is optional too — the box on the page has no "required"
  assertEquals(parseDemoRequest({ ...demo, email: "" }, NOW).email, "");
});

Deno.test("REQ-090 parseDemoRequest — the consent box is the one field never optional: unticked, absent or anything but true is refused by name, for a demo and for a call", () => {
  const field = (input: unknown) =>
    assertThrows(() => parseDemoRequest(input, NOW), DemoRequestInvalid).field;
  assertEquals(field({ ...demo, consent: false }), "consent");
  assertEquals(field({ ...call, consent: false }), "consent");
  assertEquals(field({ ...demo, consent: undefined }), "consent");
  assertEquals(field({ ...call, consent: "true" }), "consent");
  assertEquals(field({ ...call, consent: 1 }), "consent");
});

Deno.test("REQ-090 parseDemoRequest — every malformed field is refused by name", () => {
  const field = (input: unknown) =>
    assertThrows(() => parseDemoRequest(input, NOW), DemoRequestInvalid).field;
  assertEquals(field({ ...demo, mode: "visit" }), "mode");
  assertEquals(field({ ...demo, name: "   " }), "name"); // a demo has a name
  assertEquals(field({ ...demo, name: "x".repeat(121) }), "name");
  assertEquals(field({ ...call, name: "x".repeat(121) }), "name");
  assertEquals(field({ ...demo, phone: "12345" }), "phone");
  assertEquals(field({ ...call, phone: "" }), "phone");
  assertEquals(field({ ...demo, email: "not-an-email" }), "email");
  assertEquals(field({ ...call, email: "not-an-email" }), "email");
  assertEquals(field({ ...demo, day: "" }), "day"); // a demo has a day
  assertEquals(field({ ...demo, day: "20/10/2026" }), "day");
  assertEquals(field({ ...demo, day: "2026-02-30" }), "day");
  assertEquals(field({ ...demo, day: "2026-10-17" }), "day"); // yesterday
  assertEquals(field({ ...demo, day: "2027-03-01" }), "day"); // past the 90-day window
  assertEquals(field({ ...demo, slot: "" }), "slot"); // a demo has a window
  assertEquals(field({ ...demo, slot: "11:00 AM" }), "slot"); // the old hours are no window
  assertEquals(field({ ...demo, slot: "evening" }), "slot");
  assertEquals(field({ ...call, day: "2026-10-20" }), "day"); // a call carries no day…
  assertEquals(field({ ...call, slot: "morning" }), "slot"); // …and no window
  assertEquals(field({ ...demo, lang: "fr" }), "lang");
  assertEquals(field("nope"), "body");
  assertEquals(field({}), "mode");
});

Deno.test("REQ-090 DEMO_SLOTS — the two windows the page offers, morning and afternoon, Eastern, labelled in both languages", () => {
  assertEquals(DEMO_SLOTS.map((s) => s.id), ["morning", "afternoon"]);
  assertEquals(DEMO_SLOTS[0].short.es, "Mañana (9–12)");
  assertEquals(DEMO_SLOTS[0].short.en, "Morning (9–12)");
  assertEquals(DEMO_SLOTS[1].short.es, "Tarde (1–5)");
  assertEquals(DEMO_SLOTS[1].short.en, "Afternoon (1–5)");
  assertEquals(
    demoSlotLabel("morning", "es"),
    "Mañana, 9 AM – 12 PM (hora del Este)",
  );
  assertEquals(
    demoSlotLabel("afternoon", "en"),
    "Afternoon, 1 – 5 PM (Eastern)",
  );
});

Deno.test("REQ-081 demoDayLabel — the day as the page shows it, in either language", () => {
  assertEquals(demoDayLabel("2026-10-17", "es"), "Sáb 17 Oct");
  assertEquals(demoDayLabel("2026-10-17", "en"), "Sat 17 Oct");
  assertEquals(demoDayLabel("2026-12-01", "es"), "Mar 1 Dic");
});

Deno.test("REQ-090 demoSummary + demoConfirmationSms — a demo names the day and the window; a call says as soon as possible; the name only when there is one; the line to call; the person's language", () => {
  assertEquals(
    demoSummary(parseDemoRequest(demo, NOW)),
    "Demo de 15 min · Mar 20 Oct · Mañana, 9 AM – 12 PM (hora del Este)",
  );
  assertEquals(
    demoSummary(parseDemoRequest({ ...call, lang: "en" }, NOW)),
    "Phone call · as soon as possible",
  );
  const es = demoConfirmationSms(parseDemoRequest(demo, NOW));
  assertMatch(es, /^DocuMonster: ¡listo, José García!/);
  assertMatch(
    es,
    /Demo de 15 min · Mar 20 Oct · Mañana, 9 AM – 12 PM \(hora del Este\)/,
  );
  assertMatch(es, /855-362-8666/);
  const en = demoConfirmationSms(
    parseDemoRequest({ ...call, lang: "en" }, NOW),
  );
  assertMatch(
    en,
    /^DocuMonster: you're booked! We'll call you — Phone call · as soon as possible\./,
  );
  assertMatch(en, /855-362-8666/);
  const esCall = demoConfirmationSms(parseDemoRequest(call, NOW));
  assertMatch(
    esCall,
    /^DocuMonster: ¡listo! Te llamamos — Llamada · lo antes posible\./,
  );
});

Deno.test("REQ-090 demoTeamEmail — the team's email carries every field of the booking, escaped, with the consent on record; a call says as soon as possible and shows the missing name as none", () => {
  const mail = demoTeamEmail(
    parseDemoRequest(
      { ...demo, name: "José <García>", slot: "afternoon" },
      NOW,
    ),
  );
  assertMatch(mail.subject, /^\[demo\] José <García> — 2026-10-20 afternoon$/);
  assertMatch(mail.htmlBody, /José &lt;García&gt;/);
  assertMatch(mail.htmlBody, /\+15125550199/);
  assertMatch(mail.htmlBody, /jose@tunegocio\.com/);
  assertMatch(mail.htmlBody, /15-min demo/);
  assertMatch(
    mail.htmlBody,
    /Tue 20 Oct \(2026-10-20\) · Afternoon, 1 – 5 PM Eastern/,
  );
  assertMatch(mail.htmlBody, /Consent:<\/strong> yes/);
  assertMatch(mail.htmlBody, /Spanish/); // the language the person wrote in
  const quick = demoTeamEmail(parseDemoRequest({ ...call, lang: "en" }, NOW));
  assertMatch(quick.subject, /^\[call\] \+15125550199 — as soon as possible$/);
  assertMatch(quick.htmlBody, /When:<\/strong> as soon as possible/);
  assertMatch(quick.htmlBody, /Name:<\/strong> —/);
  assertMatch(quick.htmlBody, /Email:<\/strong> —/);
  assertMatch(quick.htmlBody, /Consent:<\/strong> yes/);
  assertMatch(quick.htmlBody, /English/);
});
