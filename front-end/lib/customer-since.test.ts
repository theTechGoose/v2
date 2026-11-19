/**
 * REQ-1042 (LOOP-007 cycle 2, q2-26) — the customer workspace's "Customer since" date reads
 * "Nov 19, 2026" like every other screen, not "Nov 19 2026". The island glued the raw ISO year
 * (`c.createdAt.slice(0, 4)`) onto a month-day string from its local `day()` helper, so en-US
 * never put its comma in. The whole date goes through Intl with `year: "numeric"`, from a shared
 * helper `fmtDayYear(iso, lang)` in front-end/lib/format.ts.
 */
import { assert, assertEquals } from "@std/assert";
import * as format from "./format.ts";

type DayYear = (iso: string | undefined, lang: "en" | "es") => string;
const fmtDayYear = (format as Record<string, unknown>).fmtDayYear as DayYear | undefined;

const ISLAND = new URL("../islands/CustomerWorkspace.tsx", import.meta.url);

Deno.test("REQ-1042 fmtDayYear — format.ts exports the full-date helper", () => {
  assertEquals(typeof fmtDayYear, "function", "format.ts exports fmtDayYear(iso, lang)");
});

Deno.test("REQ-1042 fmtDayYear — English has its comma: 'Nov 19, 2026'", () => {
  assert(fmtDayYear, "format.ts exports fmtDayYear(iso, lang)");
  assertEquals(fmtDayYear("2026-11-19T15:04:05.000Z", "en"), "Nov 19, 2026");
  assertEquals(fmtDayYear("2026-01-02T00:00:00.000Z", "en"), "Jan 2, 2026");
  // a UTC-late timestamp stays on its own calendar day
  assertEquals(fmtDayYear("2026-11-19T23:59:59.000Z", "en"), "Nov 19, 2026");
});

Deno.test("REQ-1042 fmtDayYear — Spanish stays '19 nov 2026'; no date is '—'", () => {
  assert(fmtDayYear, "format.ts exports fmtDayYear(iso, lang)");
  assertEquals(fmtDayYear("2026-11-19T15:04:05.000Z", "es"), "19 nov 2026");
  assertEquals(fmtDayYear(undefined, "en"), "—");
});

Deno.test("REQ-1042 the 'Customer since' row formats the whole date, never glues the ISO year on by hand", async () => {
  const src = await Deno.readTextFile(ISLAND);
  const at = src.indexOf(`"customerWs.ov.since"`);
  assert(at > 0, "the island renders customerWs.ov.since");
  const dd = src.slice(at, src.indexOf("</dd>", at) + 5);
  assert(!/createdAt\.slice\(0,\s*4\)/.test(dd), `the year is not cut from the ISO string (got ${dd.trim()})`);
  assert(/fmtDayYear\(c\.createdAt,\s*lang\)/.test(dd), `the row renders fmtDayYear(c.createdAt, lang) (got ${dd.trim()})`);
});
