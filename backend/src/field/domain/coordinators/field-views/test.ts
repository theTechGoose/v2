/** REQ-365 — demo cycle 1, p15-17: a task with no zone answers regionName "", never "—". */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { FieldViews, type Names } from "./mod.ts";
import type { FieldTask, Region } from "@field/dto/field.ts";

const zone = { id: "r1", name: "Zone 1" } as Region;
const names: Names = {
  customer: () => "Ana",
  type: () => "Mulch",
  worker: () => "Miguel Torres",
  region: (id) => (id === "r1" ? zone : null),
  checklist: () => null, // REQ-811
  crew: () => null, // REQ-840
};
// task() only reads the names it is given — the stores are not touched
const views = new FieldViews(null!, null!, null!, null!, null!, null!, null!, null!);
const task = (regionId: string) =>
  ({
    id: "t",
    regionId,
    customerId: "c",
    taskTypeId: "y",
    workerId: "w",
  }) as FieldTask;

Deno.test("REQ-365 FieldViews.task — a one-off with no zone has an empty regionName", () => {
  assertEquals(views.task(task(""), names).regionName, "");
});

Deno.test("REQ-365 FieldViews.task — a zone that no longer exists is an empty regionName too", () => {
  assertEquals(views.task(task("gone"), names).regionName, "");
});

Deno.test("REQ-365 FieldViews.task — a zoned task keeps its zone's name", () => {
  assertEquals(views.task(task("r1"), names).regionName, "Zone 1");
});

// REQ-1162 (LOOP-007 q3, q3-94) — safety net: a task whose worker no longer exists reads
// "Unassigned", never Worker "—" next to status ASSIGNED.
Deno.test("REQ-1162 (q3-94) FieldViews.task — a task whose worker was removed is marked unassigned", () => {
  const n: Names = { ...names, worker: (id) => (id === "w" ? "Miguel Torres" : "—") };
  const orphan = { ...task("r1"), workerId: "removed", status: "assigned" } as FieldTask;
  const v = views.task(orphan, n) as { unassigned?: boolean; workerName: string };
  assertEquals(v.unassigned, true, `a missing worker is flagged (got workerName ${JSON.stringify(v.workerName)})`);
});

Deno.test("REQ-1162 (q3-94) FieldViews.task — a task with a live worker is not marked unassigned", () => {
  const n: Names = { ...names, worker: (id) => (id === "w" ? "Miguel Torres" : "—") };
  const v = views.task({ ...task("r1"), status: "assigned" } as FieldTask, n) as { unassigned?: boolean; workerName: string };
  assertEquals([v.workerName, v.unassigned ?? false], ["Miguel Torres", false]);
});
