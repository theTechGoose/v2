/**
 * REQ-1160 — LOOP-007 cycle 3, QA issues q3-92 [minor/BUG_POLISH] "Worker header date follows the
 * viewed day, not today" and q3-100 [polish/BUG_POLISH] "Worker sign-in screen after logout shows the
 * last viewed day, not today".
 *
 * WorkerScreen's greeting line (`<small>{dayLine()}</small>` under "Hola, <name>" and under
 * "Mis tareas" when signed out) must name TODAY, the business's day (REQ-940 `today`), not the day
 * being viewed (`date`, set by Mañana / ?date=). The viewed day already has its own "Viendo" label.
 * And Salir must put the screen back on today: `date` reset and `?date=` dropped from the URL.
 */
import * as fs from "fs";
import * as path from "path";
import * as field from "../../front-end/lib/field";

const ROOT = path.resolve(__dirname, "../..");
const screen = fs.readFileSync(
  path.join(ROOT, "front-end/islands/WorkerScreen.tsx"),
  "utf8",
);

/** the source from `start` to the first `;` (or closing brace) at bracket depth 0 */
function sliceBalanced(from: number, stopAtSemicolon: boolean): string {
  let depth = 0;
  let quote = "";
  for (let i = from; i < screen.length; i++) {
    const c = screen[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (!stopAtSemicolon && depth === 0) return screen.slice(from, i + 1);
    } else if (c === ";" && depth === 0 && stopAtSemicolon) {
      return screen.slice(from, i);
    }
  }
  throw new Error("unbalanced source");
}

/** dayLine's initialiser, evaluated against the real lib/field exports */
function dayLineFor(date: string, today: string, lang: "en" | "es"): string {
  const at = screen.indexOf("const dayLine =");
  expect(at).toBeGreaterThan(-1);
  const init = sliceBalanced(at + "const dayLine =".length, true).trim();
  const names = Object.keys(field).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
  const values = names.map((k) => (field as Record<string, unknown>)[k]);
  // deno-lint-ignore no-new-func
  const make = new Function(
    ...names,
    "date",
    "today",
    "lang",
    `return (${init});`,
  );
  const fn = make(...values, date, today, lang) as () => string;
  return fn();
}

describe("REQ-1160 (LOOP-007 q3-92, q3-100): the worker greeting line names today, not the viewed day", () => {
  const TODAY = "2026-11-19";
  const TOMORROW = "2026-11-20";

  test("REQ-1160 q3-92: both greeting blocks render dayLine() in their <small>", () => {
    const greets = screen.match(/<small>\{dayLine\(\)\}<\/small>/g) ?? [];
    expect(greets.length).toBe(2);
  });

  test("REQ-1160 q3-92: viewing tomorrow (Mañana / ?date=) the header still reads today's label (es)", () => {
    expect(dayLineFor(TOMORROW, TODAY, "es")).toBe(
      field.fmtDayLabel(TODAY, "es"),
    );
    expect(dayLineFor(TOMORROW, TODAY, "es")).not.toBe(
      field.fmtDayLabel(TOMORROW, "es"),
    );
  });

  test("REQ-1160 q3-92: viewing yesterday the header still reads today's label (en)", () => {
    expect(dayLineFor("2026-11-18", TODAY, "en")).toBe(
      field.fmtDayLabel(TODAY, "en"),
    );
  });

  test("REQ-1160 q3-92: on today the header is unchanged (REQ-1065 casing)", () => {
    expect(dayLineFor(TODAY, TODAY, "es")).toBe(field.fmtDayLabel(TODAY, "es"));
  });

  test("REQ-1160 q3-100: Salir puts the screen back on today — logout() resets `date` and drops ?date= from the URL", () => {
    const at = screen.indexOf("function logout()");
    expect(at).toBeGreaterThan(-1);
    const body = sliceBalanced(screen.indexOf("{", at), false);
    expect(body).toMatch(/setDate\(\s*todayRef\.current\s*\)|setDate\(\s*today\s*\)/);
    expect(body).toMatch(/dateRef\.current\s*=\s*(todayRef\.current|today)/);
    expect(body).toMatch(/searchParams\.delete\(\s*["']date["']\s*\)/);
    expect(body).toMatch(/history\.replaceState\(/);
  });
});
