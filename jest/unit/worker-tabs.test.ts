/**
 * REQ-193 — the worker's screen is two tabs: Tasks (the day's visits) and Time clock (REQ-192's
 * clock with the hours open); the clock stays mounted so its state dots the tab; ?tab=clock opens it.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-193 the worker's tabs", () => {
  const screen = read("front-end/islands/WorkerScreen.tsx");
  test("two tabs, Tasks first and selected by default, the clock behind ?tab=clock", () => {
    expect(screen).toMatch(/useState<"tasks" \| "clock">\("tasks"\)/);
    expect(screen).toMatch(/data-cy="w-tab-tasks"/);
    expect(screen).toMatch(/data-cy="w-tab-clock"/);
    expect(screen).toMatch(/get\("tab"\) === "clock"/);
    expect(screen).toMatch(/searchParams\.set\("tab", "clock"\)/);
  });
  test("the clock pane keeps the clock mounted (hidden, not unmounted) with the hours open, and dots the tab", () => {
    expect(screen).toMatch(/hidden=\{tab !== "clock"\}/);
    expect(screen).toMatch(
      /<WorkerClock hoursOpen onState=\{setClockState\} \/>/,
    );
    expect(screen).toMatch(/data-cy="w-tab-clock-dot"/);
    expect(screen).toMatch(/hidden=\{tab !== "tasks"\}/);
    const card = read("front-end/components/timeclock/WorkerClock.tsx");
    expect(card).toMatch(/hoursOpen = false, onState/);
    expect(card).toMatch(/useState\(hoursOpen\)/);
  });
  test("both dictionaries name the tabs", () => {
    const en = JSON.parse(read("lang/en.json")),
      es = JSON.parse(read("lang/es.json"));
    expect([en["worker.tabTasks"], en["worker.tabClock"]]).toEqual([
      "Tasks",
      "Time clock",
    ]);
    expect([es["worker.tabTasks"], es["worker.tabClock"]]).toEqual([
      "Tareas",
      "Reloj",
    ]);
  });
});
