/**
 * REQ-495 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3 (run re05e1cbb), issue m17 "US or raw dates in the
 * Spanish UI", RCA CONFIRMED / skeptic CORRECTED at cc5d4b0e:
 *
 * - (a) invoice cards read "VENCE dic 19", "Emitida nov 12. Vence dic 12.",
 *   "Programada para enviar nov 19" — cardDate put the month first in every
 *   language (only the word was translated).
 * - (b) the wizard's "Pick a date" stored "12/01/2026" (MM/DD/YYYY) as the
 *   start-date term and nothing localized it, so a Spanish reader saw 12 Jan.
 */
import { assert, assertEquals } from "@std/assert";
import { cardDate, scheduledSubline } from "./invoice-card.ts";
import { localizeTermValue } from "./term-i18n.ts";

const NOW = new Date("2026-11-12T12:00:00");

Deno.test("REQ-495 m17 (a): a Spanish invoice card date is day-first — '19 dic', '5 ene 2027'", () => {
  assertEquals(cardDate("2026-12-19", NOW, "es"), "19 dic");
  assertEquals(cardDate("2027-01-05", NOW, "es"), "5 ene 2027");
  assertEquals(
    scheduledSubline("2026-11-19", NOW, "es"),
    // REQ-697 AMENDMENT (cycle 5, m22): a scheduled invoice reads as a reminder; the date is
    // still day-first
    "Te recordamos enviarla el 19 nov",
  );
});

Deno.test("REQ-495 m17 (a): the English card date stays month-first", () => {
  assertEquals(cardDate("2026-12-19", NOW, "en"), "Dec 19");
  assertEquals(cardDate("2027-01-05", NOW, "en"), "Jan 5, 2027");
});

Deno.test("REQ-495 m17 (b): a start-date term stored as ISO reads in the reader's language", () => {
  assertEquals(localizeTermValue("2026-12-01", "es"), "1 dic 2026");
  assertEquals(localizeTermValue("2026-12-01", "en"), "Dec 1, 2026");
});

Deno.test("REQ-495 m17 (b): a start-date term already stored as MM/DD/YYYY still localizes", () => {
  assertEquals(localizeTermValue("12/01/2026", "es"), "1 dic 2026");
  assertEquals(localizeTermValue("12/01/2026", "en"), "Dec 1, 2026");
});

Deno.test("REQ-495 m17 (b): non-date terms keep their old localization", () => {
  assertEquals(localizeTermValue("3 weeks", "es"), "3 semanas");
  assertEquals(localizeTermValue("50/50", "es"), "50/50");
  assertEquals(localizeTermValue("Next week", "en"), "Next week");
  // Not a calendar day — left alone, never turned into a date.
  assertEquals(localizeTermValue("13/45/2026", "es"), "13/45/2026");
});

Deno.test("REQ-495 m17 (b): the date picker submits ISO and labels the pick in the app's language", () => {
  const src = Deno.readTextFileSync(
    new URL("../islands/AsstChat.tsx", import.meta.url),
  );
  const start = src.indexOf("function CustomDatePickerForm(");
  assert(start > 0, "CustomDatePickerForm exists");
  const body = src.slice(start, src.indexOf("\nfunction ", start + 10));
  assert(/onSubmit\(toIso\(picked\)\)/.test(body), "submits toIso(picked)");
  assert(!/toUsDate/.test(body), "no MM/DD/YYYY submit left");
  assert(
    !/toLocale(Date)?String\(\s*"default"/.test(body),
    "no browser-locale ('default') labels in the picker",
  );
  // The "From your message: …" prefill shows the date localized, not raw.
  assert(
    /formatTermDate\(\s*prefill\.customValue/.test(src),
    "the prefill label formats its date",
  );
});
