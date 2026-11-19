/**
 * REQ-1065 — LOOP-007 cycle 2, QA issue q2-54 [polish/BUG_POLISH]: "Spanish worker dates use mixed
 * capitalisation on one screen". On /worker (ES) the header reads "Jue 19 de nov" (dayLine()
 * upper-cases the first letter), while the day-strip tab (`<small>{fmtDay(iso, lang)}</small>`) and
 * the REQ-528 "Viendo" label (`<b>{fmtDay(date, lang)}</b>`) call fmtDay() directly and show the
 * raw es-MX output "jue 19 de nov".
 *
 * Every standalone day label on the worker screen must carry the same capitalised text for the same
 * day. The mid-sentence deferredFrom message ("aplazada de jue 19 de nov") stays lowercase.
 */
import * as fs from "fs";
import * as path from "path";
import * as field from "../../front-end/lib/field";

const ROOT = path.resolve(__dirname, "../..");
const screen = fs.readFileSync(
  path.join(ROOT, "front-end/islands/WorkerScreen.tsx"),
  "utf8",
);
const fns = field as unknown as Record<string, unknown>;

/** the JSX expression inside the first `<tag>{…}</tag>` after `anchor` */
function exprAfter(anchor: string, tag: string): string {
  const at = screen.indexOf(anchor);
  expect(at).toBeGreaterThan(-1);
  const m = screen.slice(at).match(
    new RegExp(`<${tag}>\\{([^}]*)\\}</${tag}>`),
  );
  expect(m).toBeTruthy();
  return m![1].trim();
}

/** what the expression renders for `iso` in `lang`: a `name(<day>, lang)` call to a lib/field export */
function renderLabel(expr: string, iso: string, lang: "en" | "es"): string {
  const m = expr.match(/^(\w+)\(\s*\w+\s*,\s*lang\s*\)$/);
  if (!m) throw new Error(`not a lib/field day formatter call: ${expr}`);
  const fn = fns[m[1]];
  if (typeof fn !== "function") {
    throw new Error(`${m[1]} is not exported from front-end/lib/field.ts`);
  }
  return (fn as (iso: string, lang: string) => string)(iso, lang);
}

/** the header's dayLine(): fmtDay with the first letter upper-cased */
const header = (iso: string, lang: "en" | "es") => {
  const s = field.fmtDay(iso, lang);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

describe("REQ-1065 (LOOP-007 q2-54): the worker screen's day labels share one capitalisation", () => {
  const tabExpr = exprAfter('data-cy={`w-day-${id}`}', "small");
  const labelExpr = exprAfter('data-cy="w-day-label"', "b");

  test("REQ-1065: the day-strip tab's date reads like the header in Spanish ('Jue 19 de nov')", () => {
    for (const iso of ["2026-11-19", "2026-11-20", "2026-11-18"]) {
      const got = renderLabel(tabExpr, iso, "es");
      expect(got).toBe(header(iso, "es"));
      expect(got).toMatch(/^[A-ZÁÉÍÓÚÑ]/);
    }
  });

  test("REQ-1065: the 'Viendo <day>' label reads like the header in Spanish ('Vie 20 de nov')", () => {
    for (const iso of ["2026-11-19", "2026-11-20", "2026-11-18"]) {
      const got = renderLabel(labelExpr, iso, "es");
      expect(got).toBe(header(iso, "es"));
      expect(got).toMatch(/^[A-ZÁÉÍÓÚÑ]/);
    }
  });

  test("REQ-1065: English day labels are unchanged ('Fri, Nov 20')", () => {
    expect(renderLabel(tabExpr, "2026-11-20", "en")).toBe("Fri, Nov 20");
    expect(renderLabel(labelExpr, "2026-11-20", "en")).toBe("Fri, Nov 20");
  });

  test("REQ-1065: the mid-sentence deferredFrom date stays a plain lowercase fmtDay", () => {
    expect(screen).toMatch(/date:\s*fmtDay\(\s*s\.deferredFrom\s*,\s*lang\s*\)/);
  });
});
