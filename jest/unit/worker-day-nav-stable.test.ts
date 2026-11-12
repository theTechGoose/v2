/**
 * REQ-528 — demo-loop cycle 3, demo issue m51: "Worker day navigation renames itself, shows a raw
 * '2026-11-13', and has no date picker". REQ-362's `workerDayNav` (front-end/lib/field.ts) swapped
 * its link labels by whether the viewed day was today ("Mañana →" became "Día siguiente →" after
 * one tap), and islands/WorkerScreen.tsx rendered `{t("worker.viewing")} {date}` with the ISO
 * string. Now: the links always read "← Previous day" / "Next day →" (with "Today" to jump back),
 * the viewed day is written with `fmtDay(date, lang)`, and it is a native date input that goes to
 * /worker?date= (`workerDayHref`).
 */
import * as fs from "fs";
import * as path from "path";
import { fmtDay, workerDayHref, workerDayNav } from "../../front-end/lib/field";

const ROOT = path.resolve(__dirname, "../..");
const island = fs.readFileSync(
  path.join(ROOT, "front-end/islands/WorkerScreen.tsx"),
  "utf8",
);

describe("REQ-528 (demo m51, cycle 3) the /worker day links keep one label", () => {
  test("today, tomorrow and a past day all read Previous day / Next day", () => {
    for (const date of ["2026-11-12", "2026-11-13", "2026-11-10"]) {
      const nav = workerDayNav(date, "2026-11-12");
      expect([date, nav.prev.key, nav.next.key]).toEqual([
        date,
        "worker.prevDay",
        "worker.nextDay",
      ]);
    }
  });

  test("Today is the jump back, offered only off today", () => {
    expect(workerDayNav("2026-11-12", "2026-11-12").today).toBeNull();
    expect(workerDayNav("2026-11-13", "2026-11-12").today).toBe("/worker");
  });
});

describe("REQ-528 workerDayHref — the date picker's destination", () => {
  test("a picked day opens /worker?date=", () => {
    expect(workerDayHref("2026-12-24")).toBe("/worker?date=2026-12-24");
  });
  test("the office's way back (?from=) rides along", () => {
    expect(workerDayHref("2026-12-24", "/field/workers")).toBe(
      "/worker?date=2026-12-24&from=%2Ffield%2Fworkers",
    );
  });
  test("a blank or malformed pick goes nowhere", () => {
    expect(workerDayHref("")).toBeNull();
    expect(workerDayHref("2026-13-45x")).toBeNull();
  });
  test("the nav links are built the same way", () => {
    expect(workerDayNav("2026-11-12", "2026-11-12", "/field/workers").next.href)
      .toBe(workerDayHref("2026-11-13", "/field/workers"));
  });
});

describe("REQ-528 WorkerScreen writes the viewed day, not the ISO string", () => {
  test("fmtDay gives a readable short day in both languages", () => {
    expect(fmtDay("2026-11-13", "es")).toMatch(/13/);
    expect(fmtDay("2026-11-13", "es")).toMatch(/nov/i);
    expect(fmtDay("2026-11-13", "es")).not.toMatch(/2026-11-13/);
    expect(fmtDay("2026-11-13", "en")).toMatch(/Nov 13/);
  });
  test("no raw `{date}` after the Viewing label", () => {
    expect(island).not.toMatch(/t\("worker\.viewing"\)\}\s*\{date\}/);
    expect(island).toMatch(/data-cy="w-day-label"/);
  });
  test("the day bar carries a native date input that navigates via workerDayHref", () => {
    expect(island).toMatch(/type="date"/);
    expect(island).toMatch(/data-cy="w-day-pick"/);
    expect(island).toMatch(/workerDayHref\(/);
  });
});
