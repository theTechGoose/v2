/**
 * REQ-786 (demo dv1, "Workers can clock in and out, and the owner sees their hours") — the owner
 * opens ONE worker's hours: every row on /field/workers links to /field/timesheet?worker=<id>, and
 * the timesheet narrows to that worker (their shifts and their punches) with a way back to all.
 */
import * as fs from "fs";
import * as path from "path";
import {
  onlyWorker,
  timesheetHref,
  workerFromSearch,
} from "../../front-end/lib/timesheet-filter";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dict = (rel: string) => JSON.parse(read(rel)) as Record<string, string>;

const shift = (id: string) => ({
  inPunchId: id,
  outPunchId: null,
  start: "2026-11-13T13:00:00.000Z",
  end: null,
  durationMs: null,
  open: true,
  anomaly: null,
});
const report = {
  from: "a",
  to: "b",
  asOf: "c",
  workers: [
    {
      worker: { id: "w1", name: "Ana" },
      shifts: [shift("p1")],
      totalMs: 1,
      anomalies: [],
    },
    {
      worker: { id: "w2", name: "Luis" },
      shifts: [shift("p2")],
      totalMs: 2,
      anomalies: [],
    },
  ],
};
const punch = (id: string, workerId: string) => ({
  id,
  userId: "u",
  workerId,
  type: "in" as const,
  at: "x",
  source: "worker" as const,
  reason: null,
  createdAt: "x",
  voided: null,
});

describe("REQ-786 the owner opens one worker's hours", () => {
  test("the link from a worker row carries the worker's id", () => {
    expect(timesheetHref("w 2/x")).toBe("/field/timesheet?worker=w%202%2Fx");
  });

  test("the timesheet reads ?worker= (and nothing else)", () => {
    expect(workerFromSearch("?worker=w2")).toBe("w2");
    expect(workerFromSearch("?worker=w%202%2Fx")).toBe("w 2/x");
    expect(workerFromSearch("")).toBeNull();
    expect(workerFromSearch("?worker=")).toBeNull();
    expect(workerFromSearch("?other=1")).toBeNull();
  });

  test("narrowing keeps only that worker's row and punches; no filter keeps all", () => {
    const punches = [punch("p1", "w1"), punch("p2", "w2"), punch("p3", "w2")];
    const one = onlyWorker(report, punches, "w2");
    expect(one.report?.workers.map((w) => w.worker.id)).toEqual(["w2"]);
    expect(one.punches.map((p) => p.id)).toEqual(["p2", "p3"]);
    const all = onlyWorker(report, punches, null);
    expect(all.report?.workers).toHaveLength(2);
    expect(all.punches).toHaveLength(3);
    expect(onlyWorker(null, [], "w2").report).toBeNull();
  });

  test("Workers rows link to the hours; the timesheet narrows and offers All workers", () => {
    const wk = read("front-end/islands/FieldWorkersPage.tsx");
    expect(wk).toMatch(/data-cy="wk-hours"/);
    expect(wk).toMatch(/timesheetHref\(w\.id\)/);
    expect(wk).toMatch(/t\("field\.wk\.hours"\)/);
    const ts = read("front-end/islands/TimesheetPage.tsx");
    expect(ts).toMatch(/workerFromSearch\(/);
    expect(ts).toMatch(/onlyWorker\(/);
    expect(ts).toMatch(/data-cy="ts-all-workers"/);
    expect(ts).toMatch(/t\("ts\.allWorkers"\)/);
  });

  test("both dictionaries carry the new strings", () => {
    const en = dict("lang/en.json"), es = dict("lang/es.json");
    expect(en["field.wk.hours"]).toBe("Hours");
    expect(es["field.wk.hours"]).toBe("Horas");
    expect(en["ts.allWorkers"]).toBe("All workers");
    expect(es["ts.allWorkers"]).toBe("Todos los trabajadores");
  });
});
