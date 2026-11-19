/**
 * REQ-1166 (LOOP-007 cycle 3, q3-97; REQ-157 AMENDMENT) — the New repeat
 * visit form seeds its day picks from TODAY when it opens. Typing a later
 * First visit kept today's day (the auto-filled list is never empty), so a
 * Monthly visit with First visit 2026-12-01 saved as "Monthly · day 19" and
 * its first visit came 18 days late. Picks the user never touched follow the
 * typed First visit; picks the user chose survive it.
 */
import {
  seedPicks,
  withStartDate,
} from "../../front-end/lib/subs-start-date";

describe("REQ-1166 (q3-97) the First visit date drives untouched day picks", () => {
  test("REQ-1166: a blank form opened on 2026-11-19, First visit typed 2026-12-01 → Monthly day 1, weekly Tuesday", () => {
    const blank = seedPicks("2026-11-19");
    expect(blank.daysOfMonth).toEqual([19]);
    expect(blank.days).toEqual([4]); // Thursday
    const f = withStartDate(blank, "2026-12-01");
    expect(f.startDate).toBe("2026-12-01");
    expect(f.daysOfMonth).toEqual([1]);
    expect(f.days).toEqual([2]); // Tuesday
  });

  test("REQ-1166: an annual blank form follows the typed First visit's month", () => {
    const f = withStartDate(seedPicks("2026-11-19"), "2027-03-04");
    expect(f.month).toBe(3);
    expect(f.daysOfMonth).toEqual([4]);
  });

  test("REQ-1166: days the user picked by hand (15, 31) survive a First visit change", () => {
    // the island marks hand picks on the form (toggleMonthDay); a fixed
    // helper may carry that as a flag — pass it either way
    const picked = {
      ...seedPicks("2026-11-19"),
      daysOfMonth: [15, 31],
      days: [1, 3],
      daysTouched: true,
      domTouched: true,
    };
    const f = withStartDate(picked, "2026-12-01");
    expect(f.daysOfMonth).toEqual([15, 31]);
    expect(f.days).toEqual([1, 3]);
  });
});
