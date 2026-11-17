/**
 * REQ-194 — the Tasks tab offers yesterday, today and tomorrow as one tap each; the pick switches
 * the day in place (the loader follows `date`) and rewrites ?date= (dropped for today).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-194 yesterday | today | tomorrow on the worker's Tasks tab", () => {
  const screen = read("front-end/islands/WorkerScreen.tsx");
  test("three day buttons, the viewed one selected, each with its short date", () => {
    expect(screen).toMatch(/data-cy="w-days"/);
    expect(screen).toMatch(/\(\[-1, 0, 1\] as const\)\.map/);
    expect(screen).toMatch(/data-cy=\{`w-day-\$\{id\}`\}/);
    expect(screen).toMatch(/aria-selected=\{date === iso\}/);
    expect(screen).toMatch(/fmtDay\(iso, lang\)/);
  });
  test("the pick switches in place and rewrites the URL, no reload", () => {
    expect(screen).toMatch(/function pickDay\(iso: string\)/);
    expect(screen).toMatch(/setDate\(iso\);/);
    expect(screen).toMatch(/searchParams\.delete\("date"\)/);
    expect(screen).toMatch(/searchParams\.set\("date", iso\)/);
    expect(screen).not.toMatch(/href=\{`\/worker\?date=/);
  });
  test("both dictionaries name tomorrow", () => {
    const en = JSON.parse(read("lang/en.json")),
      es = JSON.parse(read("lang/es.json"));
    expect([
      en["worker.yesterday"],
      en["worker.todayLink"],
      en["worker.tomorrow"],
    ]).toEqual(["Yesterday", "Today", "Tomorrow"]);
    expect([
      es["worker.yesterday"],
      es["worker.todayLink"],
      es["worker.tomorrow"],
    ]).toEqual(["Ayer", "Hoy", "Mañana"]);
  });
});
