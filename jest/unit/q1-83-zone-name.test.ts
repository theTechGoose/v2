/**
 * REQ-994 — LOOP-007 cycle 1, issue q1-83: in an English account the same zone
 * read "Zone A · no worker" on /field/subscriptions but "Zona A" on
 * /field/assignments and "Mike Carter · Zona A" on /field/tasks.
 *
 * The server stores zone names in Spanish (REQ-140 regionName() → "Zona A").
 * Only /field/subscriptions and /field/workers run the name through zoneName();
 * the Assignments island prints r.name raw and the Tasks page builds its group
 * title with workerZoneLabel(), which takes no language and prints the stored
 * name. One localized zone name must be used on every screen.
 */
import * as fs from "fs";
import * as path from "path";
import {
  groupTasks,
  workerZoneLabel,
} from "../../front-end/lib/field-task-groups";
import { zoneName } from "../../front-end/lib/field-worker-errors";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

// deno-lint-ignore no-explicit-any
const label = workerZoneLabel as (x: any, lang: "en" | "es") => string;
// deno-lint-ignore no-explicit-any
const group = groupTasks as (t: any[], lang: "en" | "es") => { title: string }[];

const task = {
  id: "t1",
  workerName: "Mike Carter",
  regionId: "r1",
  regionName: "Zona A",
};

describe("REQ-994 (q1-83) the zone's name follows the account language", () => {
  test("REQ-994 zoneName: English reads 'Zone A', Spanish keeps 'Zona A'", () => {
    expect(zoneName("Zona A", "en")).toBe("Zone A");
    expect(zoneName("Zona A", "es")).toBe("Zona A");
  });

  test("REQ-994 workerZoneLabel in English: 'Mike Carter · Zone A'", () => {
    expect(label(task, "en")).toBe("Mike Carter · Zone A");
  });

  test("REQ-994 workerZoneLabel in Spanish: 'Mike Carter · Zona A'", () => {
    expect(label(task, "es")).toBe("Mike Carter · Zona A");
  });

  test("REQ-994 workerZoneLabel with no zone is still the worker alone (REQ-365)", () => {
    expect(label({ ...task, regionId: "", regionName: "" }, "en")).toBe(
      "Mike Carter",
    );
  });

  test("REQ-994 groupTasks titles the /field/tasks group in the account language", () => {
    expect(group([task], "en").map((g) => g.title)).toEqual([
      "Mike Carter · Zone A",
    ]);
    expect(group([task], "es").map((g) => g.title)).toEqual([
      "Mike Carter · Zona A",
    ]);
  });
});

describe("REQ-994 (q1-83) every screen prints the localized zone name", () => {
  const asg = read("front-end/islands/FieldAssignmentsPage.tsx");
  const tasks = read("front-end/islands/FieldTasksPage.tsx");
  const subs = read("front-end/islands/FieldSubscriptionsPage.tsx");

  test("REQ-994 FieldAssignmentsPage never prints the stored r.name raw (card, aria-label, map label, popup)", () => {
    expect(asg).not.toMatch(/\{r\.name\}/); // card name + aria-label
    expect(asg).not.toMatch(/\$\{r\.name\}/); // map label
    expect(asg).not.toMatch(/el\(\s*"span",\s*r\.name\b/); // map popup
    expect(asg).toMatch(/zoneName\(/);
  });

  test("REQ-994 FieldTasksPage passes the language to the zone label and wraps the unstaffed chip", () => {
    expect(tasks).not.toMatch(/workerZoneLabel\(x\)/);
    expect(tasks).not.toMatch(/\{s\.regionName\}/);
  });

  test("REQ-994 one zoneName helper: FieldSubscriptionsPage keeps no private copy", () => {
    expect(subs).not.toMatch(/function zoneName\(/);
  });
});
