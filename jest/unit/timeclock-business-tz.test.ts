/**
 * REQ-1038 (LOOP-007 cycle 2, q2-22) — amends REQ-944 / REQ-192. A clock-in at
 * 2026-11-19T07:56Z (01:56 AM Central, business zone America/Chicago) read
 * "Clocked in at 7:56 AM" to the worker and "Thu, Nov 19 7:56 AM" on the
 * owner's /field/timesheet when the device ran in UTC.
 *
 * Targets:
 *  - front-end/islands/TimesheetPage.tsx and
 *    front-end/components/timeclock/WorkerClock.tsx format punch instants with
 *    toLocale{Time,Date}String and no `timeZone` (the device's zone);
 *  - neither island is handed the business zone (routes/field/timesheet.tsx,
 *    islands/WorkerScreen.tsx);
 *  - front-end/clients/timeclock.ts `localWeek` builds Monday 00:00 in the
 *    browser's zone, and the backend prefers those sent bounds (REQ-940 says
 *    the timeclock week is the business's week).
 */
import * as fs from "fs";
import * as path from "path";
import { localWeek } from "../../front-end/clients/timeclock";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// the business-zone parameter is what the fix adds (diagnostics are off)
const zonedWeek = localWeek as unknown as (
  now: Date,
  weeks: number,
  timeZone?: string,
) => { from: string; to: string; today: string };

/** every toLocaleTimeString/toLocaleDateString call's argument list */
function localeCalls(src: string): string[] {
  const out: string[] = [];
  const re = /\.toLocale(?:Time|Date)?String\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    out.push(src.slice(m.index, i));
  }
  return out;
}

describe("REQ-1038 q2-22: the timeclock shows punches in the business's time zone, not the device's", () => {
  it("REQ-1038 precondition: the device running this suite is not in the business zone", () => {
    // the host (and the QA tester) is anywhere but Central; the expected
    // values below are the Chicago week, which the device's own week is not
    expect(new Date("2026-11-19T07:56:00Z").getTimezoneOffset()).not.toBe(360);
  });

  it("REQ-1038 the timeclock week starts Monday 00:00 in the business zone (06:00Z for Chicago)", () => {
    // Wed Nov 18, 9:00 PM Central = Thu 03:00Z
    const w = zonedWeek(new Date("2026-11-19T03:00:00Z"), 0, "America/Chicago");
    expect(w.from).toBe("2026-11-16T06:00:00.000Z");
    expect(w.to).toBe("2026-11-23T06:00:00.000Z");
    expect(w.today).toBe("2026-11-18T06:00:00.000Z");
  });

  it("REQ-1038 a Sunday evening in Chicago (Monday 03:00Z) is still the previous business week", () => {
    const w = zonedWeek(new Date("2026-11-16T03:00:00Z"), 0, "America/Chicago");
    expect(w.from).toBe("2026-11-09T06:00:00.000Z");
    expect(w.to).toBe("2026-11-16T06:00:00.000Z");
    expect(w.today).toBe("2026-11-15T06:00:00.000Z");
    // and one week back from there
    const prev = zonedWeek(
      new Date("2026-11-16T03:00:00Z"),
      -1,
      "America/Chicago",
    );
    expect(prev.from).toBe("2026-11-02T06:00:00.000Z");
    expect(prev.to).toBe("2026-11-09T06:00:00.000Z");
  });

  it("REQ-1038 TimesheetPage and WorkerClock format every instant with a named timeZone", () => {
    for (
      const f of [
        "front-end/islands/TimesheetPage.tsx",
        "front-end/components/timeclock/WorkerClock.tsx",
      ]
    ) {
      const src = read(f);
      const zoneless = localeCalls(src).filter((c) => {
        if (/timeZone/.test(c)) return false;
        // an options object passed by name: look at where it is built
        const id = c.match(/,\s*([A-Za-z_$][\w$]*)\s*\)$/)?.[1];
        return !(id &&
          new RegExp(`\\b${id}\\b[^=;]*=[^;]*timeZone`).test(src));
      });
      expect({ file: f, zoneless }).toEqual({ file: f, zoneless: [] });
    }
  });

  it("REQ-1038 the timesheet route and the worker screen hand the business zone to the timeclock islands", () => {
    const route = read("front-end/routes/field/timesheet.tsx");
    expect(route).toMatch(/<TimesheetPage[^>]*\btimeZone=/);
    const worker = read("front-end/islands/WorkerScreen.tsx");
    expect(worker).toMatch(/<WorkerClock[^>]*\btimeZone=/);
  });
});
