/**
 * REQ-1161 — LOOP-007 cycle 3, QA issue q3-93 [polish/BUG_CONTRADICTION]: "Worker clock table day
 * label lowercase/reordered". On /worker's Reloj tab the shift table's Day column reads "jue 19"
 * (es) / "19 Thu" (en), while the header, the day tab and the "Viendo" line read "Jue 19 de nov" /
 * "Thu, Nov 19" (REQ-1065, lib/field fmtDayLabel). WorkerClock.tsx formats the cell with its own
 * private fmtDayOf ({ weekday: "short", day: "numeric", timeZone }, no month, no capital).
 *
 * The clock table's day cell must render through a shared lib/field formatter (one source for every
 * day label on the screen) that gives the REQ-1065 label for the punch's BUSINESS day (REQ-1038).
 */
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import * as field from "../../front-end/lib/field";

const ROOT = path.resolve(__dirname, "../..");
const clock = fs.readFileSync(
  path.join(ROOT, "front-end/components/timeclock/WorkerClock.tsx"),
  "utf8",
);
const fns = field as unknown as Record<string, unknown>;

type DayFn = (iso: string, lang: string, timeZone?: string) => string;

/** the shift row's first `<td>{…}</td>` (the Day column) */
function dayCellExpr(): string {
  const at = clock.indexOf('data-cy="clock-shift"');
  expect(at).toBeGreaterThan(-1);
  const m = clock.slice(at).match(/<td>\{([^}]*)\}<\/td>/);
  expect(m).toBeTruthy();
  return m![1].trim();
}

/** a local `const name = (…) => …;` arrow in WorkerClock.tsx, transpiled so the red shows its output */
function localHelper(name: string): DayFn | null {
  const m = clock.match(
    new RegExp(`const ${name} = \\(([^)]*)\\) =>([\\s\\S]*?\\);)\\n`),
  );
  if (!m) return null;
  const js = ts.transpile(
    `const locale = (lang: string) => lang === "es" ? "es-MX" : "en-US";
     return (${m[1]}) => ${m[2]}`,
  );
  return new Function(js)() as DayFn;
}

/** what the Day cell renders: `name(s.start, lang, timeZone)` */
function dayCell(): { name: string; fn: DayFn; shared: boolean } {
  const expr = dayCellExpr();
  const m = expr.match(/^(\w+)\(\s*s\.start\s*,\s*lang\s*,\s*timeZone\s*\)$/);
  if (!m) throw new Error(`the Day cell is not a (s.start, lang, timeZone) call: ${expr}`);
  const name = m[1];
  if (typeof fns[name] === "function") {
    return { name, fn: fns[name] as DayFn, shared: true };
  }
  const local = localHelper(name);
  if (!local) throw new Error(`${name} is neither a lib/field export nor a local helper`);
  return { name, fn: local, shared: false };
}

describe("REQ-1161 (LOOP-007 q3-93): the worker clock table's Day column reads like every other day label", () => {
  // Thu Nov 19 2026, 9:00 AM in New York
  const MORNING = "2026-11-19T14:00:00Z";
  // Thu Nov 19 2026, 11:30 PM in New York (already Fri 04:30 in UTC)
  const LATE = "2026-11-20T04:30:00Z";
  const NY = "America/New_York";

  test("REQ-1161: the Day cell renders 'Jue 19 de nov' in Spanish, the REQ-1065 label", () => {
    const { name, fn } = dayCell();
    const got = fn(MORNING, "es", NY);
    expect(`${name} → ${got}`).toBe(`${name} → ${field.fmtDayLabel("2026-11-19", "es")}`);
    expect(got).toBe("Jue 19 de nov");
  });

  test("REQ-1161: the Day cell renders 'Thu, Nov 19' in English, the REQ-1065 label", () => {
    const { name, fn } = dayCell();
    const got = fn(MORNING, "en", NY);
    expect(`${name} → ${got}`).toBe(`${name} → ${field.fmtDayLabel("2026-11-19", "en")}`);
    expect(got).toBe("Thu, Nov 19");
  });

  test("REQ-1161 (keeps REQ-1038): a 23:30 business-time punch stays on its business day", () => {
    const { fn } = dayCell();
    expect(fn(LATE, "es", NY)).toBe("Jue 19 de nov");
    expect(fn(LATE, "en", NY)).toBe("Thu, Nov 19");
  });

  test("REQ-1161: the Day cell uses a shared lib/field formatter, not a private one", () => {
    const { name, shared } = dayCell();
    expect(`${name} exported from front-end/lib/field.ts: ${shared}`).toBe(
      `${name} exported from front-end/lib/field.ts: true`,
    );
    expect(clock).toMatch(
      new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"\\.\\./\\.\\./lib/field\\.ts"`),
    );
  });
});
