/**
 * REQ-1085 (LOOP-007 cycle 3, issue q3-10; extends REQ-961 to /quotes) —
 * Raphael: "test every single aspect of this application … one Opus agent per
 * issue to do root cause analysis, then one to write the test, then one to fix
 * it and make it green."
 *
 * q3-10: /quotes printed one quote's total through the no-cents KPI formatter
 * fmtMoney ($6,450.50 → "$6,451") on the "Decided this month" row, the
 * "Biggest open quotes" side card and the open quote card. The Deno render
 * test front-end/components/QuotesSections.cents.test.tsx and the e2e story
 * e2e/quotes-cents drive the same amounts; this pins the formatter in the
 * jest lane the gate runs.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const sections = read("front-end/components/QuotesSections.tsx");
const card = read("front-end/islands/QuoteCard.tsx");

/** the formatter call that wraps `expr` on the line matching `anchor` */
function formatterAt(src: string, anchor: RegExp, expr: string): string {
  const lines = src.split("\n");
  const i = lines.findIndex((l) => anchor.test(l));
  if (i < 0) throw new Error(`anchor ${anchor} not found`);
  const win = lines.slice(i, i + 4).join("\n");
  const esc = expr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = win.match(new RegExp(`(\\w+)\\(\\s*${esc}\\s*\\)`));
  if (!m) throw new Error(`no formatter call on ${expr} near ${anchor}`);
  return m[1];
}

describe("REQ-1085 q3-10: one quote's total is shown to the cent on /quotes", () => {
  it("REQ-1085: the 'Decided this month' row (qdone__amt) formats q.value with fmtMoneyExact", () => {
    expect(formatterAt(sections, /class=\{`qdone__amt/, "q.value")).toBe(
      "fmtMoneyExact",
    );
  });

  it("REQ-1085: the 'Biggest open quotes' row (qbig__amt) formats q.value with fmtMoneyExact", () => {
    expect(formatterAt(sections, /class="qbig__amt"/, "q.value")).toBe(
      "fmtMoneyExact",
    );
  });

  it("REQ-1085: the open quote card (qcard__val-num) formats q.value with fmtMoneyExact", () => {
    expect(formatterAt(card, /class="qcard__val-num"/, "q.value")).toBe(
      "fmtMoneyExact",
    );
  });
});
