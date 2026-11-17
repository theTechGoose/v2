/**
 * REQ-365 — demo cycle 1, issue p15-17: a one-off task for a customer with no
 * subscription has no zone, and /field/tasks titled its group "Miguel Torres · —"
 * (the API substituted "—" for the missing zone name and the island printed
 * `${workerName} · ${regionName}` unconditionally). The groups now come from
 * front-end/lib/field-task-groups.ts: keyed by worker + zone id, titled with the
 * worker alone when there is no zone.
 */
import * as fs from "fs";
import * as path from "path";
import {
  groupTasks,
  workerZoneLabel,
} from "../../front-end/lib/field-task-groups";

const ROOT = path.resolve(__dirname, "../..");
const island = fs.readFileSync(
  path.join(ROOT, "front-end/islands/FieldTasksPage.tsx"),
  "utf8",
);

const zoned = {
  id: "a",
  workerName: "Miguel Torres",
  regionId: "r1",
  regionName: "Zone 1",
};
const oneOff = {
  id: "b",
  workerName: "Miguel Torres",
  regionId: "",
  regionName: "",
};

describe("REQ-365 workerZoneLabel — a task with no zone shows the worker alone", () => {
  test("zoned task: 'Worker · Zone'", () => {
    expect(workerZoneLabel(zoned)).toBe("Miguel Torres · Zone 1");
  });
  test("one-off with no zone: just the worker, no dangling separator", () => {
    expect(workerZoneLabel(oneOff)).toBe("Miguel Torres");
    expect(workerZoneLabel({ workerName: "Miguel Torres" })).toBe(
      "Miguel Torres",
    );
  });
});

describe("REQ-365 groupTasks — grouped by worker + zone id", () => {
  test("a one-off and a zoned task of the same worker are two groups, first-seen order", () => {
    const g = groupTasks([oneOff, zoned, { ...zoned, id: "c" }]);
    expect(g.map((x) => [x.title, x.rows.map((r) => r.id)])).toEqual([
      ["Miguel Torres", ["b"]],
      ["Miguel Torres · Zone 1", ["a", "c"]],
    ]);
    expect(new Set(g.map((x) => x.key)).size).toBe(2);
  });
  test("no group title ends with a dash", () => {
    for (const x of groupTasks([oneOff, zoned])) {
      expect(x.title).not.toMatch(/·\s*(—|-)?\s*$/);
    }
  });
});

describe("REQ-365 FieldTasksPage uses the helper", () => {
  test("the island no longer builds `${workerName} · ${regionName}` by hand", () => {
    expect(island).not.toMatch(/workerName\}\s*·\s*\{?\$?\{?x\.regionName/);
    expect(island).toMatch(/groupTasks\(/);
    expect(island).toMatch(/workerZoneLabel\(/);
  });
});
