/**
 * REQ-940 (LOOP-007 q1, q1-11) — one field day, the business's. The worker island must not
 * replace the server's day (ssr.date / the API's answer) with the browser's local date after
 * hydration, and the office's /field/tasks must not start from the browser's date: a phone or
 * laptop in another zone (the QA tester's headless browser ran in UTC) labels a day "Today" that
 * the server then refuses with a 409.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-940 (q1-11) the front end's 'today' is the server's business day, not the browser's clock", () => {
  test("REQ-940 WorkerScreen does not overwrite today/date with the browser's todayIso() after hydration", () => {
    const screen = read("front-end/islands/WorkerScreen.tsx");
    expect(screen).not.toMatch(/setToday\(\s*todayIso\(\)\s*\)/);
    expect(screen).not.toMatch(/const now = todayIso\(\);\s*setToday\(now\);/);
  });
  test("REQ-940 FieldTasksPage does not start the office day from the browser's todayIso()", () => {
    const page = read("front-end/islands/FieldTasksPage.tsx");
    expect(page).not.toMatch(/useState<string>\(\(\) => todayIso\(\)\)/);
  });
});
