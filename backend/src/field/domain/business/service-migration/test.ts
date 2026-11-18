/**
 * REQ-927 — "in services we need a way to migrate services to another and segment it out so we
 * can undo redo or move that segment to another spot, this way we are able to delete services
 * without fucking up the integrity of the system" + "if something used to be x and we migrate to
 * y we mark records as belonging to x before". Pure.
 */
import { assert, assertEquals } from "#std/assert";
import { migrateService, moveSegment, redoSegment, undoSegment, type World } from "./mod.ts";
import type { Checklist, Crew, FieldTask, ServiceMigration, Subscription, TaskType } from "@field/dto/field.ts";

const NOW = "2026-11-18T12:00:00.000Z";
const A: TaskType = { id: "A", userId: "u", name: "Mowing", description: "old name", createdAt: "2026-01-01T00:00:00.000Z" };

function sub(id: string, items: [string, number][]): Subscription {
  return {
    id, userId: "u", customerId: "c-" + id, address: id + " Oak St", lat: 0, lng: 0,
    items: items.map(([taskTypeId, priceCents]) => ({ taskTypeId, priceCents })),
    cadence: "weekly", active: true, createdAt: NOW, updatedAt: NOW,
  };
}
function ckl(id: string, items: [string, number][]): Checklist {
  return { id, userId: "u", name: id, items: items.map(([taskTypeId, priceCents]) => ({ taskTypeId, priceCents })), createdAt: NOW, updatedAt: NOW };
}
function task(id: string, taskTypeId: string, status: FieldTask["status"] = "assigned"): FieldTask {
  return {
    id, userId: "u", subscriptionId: "s1", taskTypeId, customerId: "c", regionId: "r", workerId: "w",
    date: "2026-11-10", priceCents: 5000, status,
  };
}
function crew(id: string, taskTypeIds: string[]): Crew {
  return { id, userId: "u", name: "Crew " + id, color: "#000", taskTypeIds, createdAt: NOW, updatedAt: NOW };
}
function world(): World {
  return {
    subscriptions: [sub("s1", [["A", 4000], ["X", 1000]]), sub("s2", [["A", 3000], ["B", 2500]]), sub("s3", [["X", 1000]])],
    checklists: [ckl("k1", [["A", 4500]])],
    tasks: [task("t1", "A", "complete"), task("t2", "A"), task("t3", "X")],
    crews: [crew("c1", ["A", "X"]), crew("c2", ["B"])],
  };
}
const ok = <T>(r: { ok: true } & T | { ok: false; code: string }): T => {
  if (!r.ok) throw new Error("refused: " + (r as { code: string }).code);
  return r as T;
};
type Applied = { seg: ServiceMigration; world: World; changed: { subscriptions: string[]; checklists: string[]; tasks: string[]; crews: string[] } };

Deno.test("REQ-927 migrateService: every record on A moves to B — repeat visits, checklists, tasks (history too), crews — and each is marked 'was A'", () => {
  const w = world();
  const r = ok<Applied>(migrateService(w, { id: "m1", userId: "u", from: A, toTypeId: "B", now: NOW }));
  const s1 = r.world.subscriptions.find((s) => s.id === "s1")!;
  assertEquals(s1.items, [{ taskTypeId: "B", priceCents: 4000, migratedFrom: [{ typeId: "A", migrationId: "m1" }] }, { taskTypeId: "X", priceCents: 1000 }]);
  // s2 already had B: the A row merges into it (kept on the segment), B keeps its own price
  assertEquals(r.world.subscriptions.find((s) => s.id === "s2")!.items, [{ taskTypeId: "B", priceCents: 2500 }]);
  assertEquals(r.seg.merged, [{ kind: "subscription", id: "s2", at: 0, item: { taskTypeId: "A", priceCents: 3000 } }]);
  assertEquals(r.world.checklists[0].items, [{ taskTypeId: "B", priceCents: 4500, migratedFrom: [{ typeId: "A", migrationId: "m1" }] }]);
  // a completed task moves too — nothing is left pointing at A
  assertEquals(r.world.tasks.map((t) => [t.id, t.taskTypeId, t.migratedFrom]), [
    ["t1", "B", [{ typeId: "A", migrationId: "m1" }]],
    ["t2", "B", [{ typeId: "A", migrationId: "m1" }]],
    ["t3", "X", undefined],
  ]);
  // crew c1 did A; B is crew c2's, so A just leaves c1's list (c1 keeps X)
  assertEquals(r.world.crews.map((c) => c.taskTypeIds), [["X"], ["B"]]);
  assertEquals(r.seg.refs, { subscriptions: ["s1", "s2"], checklists: ["k1"], tasks: ["t1", "t2"], crews: [{ id: "c1", action: "dropped" }] });
  assertEquals(r.changed, { subscriptions: ["s1", "s2"], checklists: ["k1"], tasks: ["t1", "t2"], crews: ["c1"] });
  assertEquals([r.seg.state, r.seg.fromTypeId, r.seg.toTypeId, r.seg.from], ["applied", "A", "B", { name: "Mowing", description: "old name", createdAt: A.createdAt }]);
  assertEquals(r.seg.history, [{ action: "migrate", toTypeId: "B", at: NOW }]);
  // the input is untouched (all-or-nothing: callers persist only `changed`)
  assertEquals(w.subscriptions[0].items[0].taskTypeId, "A");
});

Deno.test("REQ-927 migrateService: a crew's service becomes the target when nobody else does it; same service or nothing on A is refused; a crew left with no service is refused", () => {
  const w = world();
  w.crews = [crew("c1", ["A"])];
  const r = ok<Applied>(migrateService(w, { id: "m1", userId: "u", from: A, toTypeId: "B", now: NOW }));
  assertEquals(r.world.crews[0].taskTypeIds, ["B"]);
  assertEquals(r.seg.refs.crews, [{ id: "c1", action: "replaced" }]);

  assertEquals(migrateService(world(), { id: "m", userId: "u", from: A, toTypeId: "A", now: NOW }), { ok: false, code: "same_service" });
  const empty: World = { subscriptions: [], checklists: [], tasks: [], crews: [] };
  assertEquals(migrateService(empty, { id: "m", userId: "u", from: A, toTypeId: "B", now: NOW }), { ok: false, code: "nothing_to_migrate" });
  // c1 does only A, and B is c2's: dropping A would make c1 a "does any service" crew
  const w2 = world();
  w2.crews = [crew("c1", ["A"]), crew("c2", ["B"])];
  assertEquals(migrateService(w2, { id: "m", userId: "u", from: A, toTypeId: "B", now: NOW }), {
    ok: false,
    code: "migration_crew_conflict",
    detail: { crew: "Crew c1" },
  });
});

Deno.test("REQ-927 undoSegment: every marked record goes back to A, merged rows come back, crews get A back; redo moves the same records again", () => {
  const applied = ok<Applied>(migrateService(world(), { id: "m1", userId: "u", from: A, toTypeId: "B", now: NOW }));
  const u = ok<Applied>(undoSegment(applied.world, applied.seg, NOW));
  assertEquals(u.world.subscriptions.map((s) => s.items), world().subscriptions.map((s) => s.items));
  assertEquals(u.world.checklists[0].items, [{ taskTypeId: "A", priceCents: 4500 }]);
  assertEquals(u.world.tasks.map((t) => [t.taskTypeId, t.migratedFrom]), [["A", undefined], ["A", undefined], ["X", undefined]]);
  assertEquals(u.world.crews.map((c) => c.taskTypeIds), [["X", "A"], ["B"]]);
  assertEquals(u.seg.state, "undone");
  assertEquals(u.seg.history.map((h) => h.action), ["migrate", "undo"]);
  // undo twice is refused
  assertEquals(undoSegment(u.world, u.seg, NOW), { ok: false, code: "segment_not_applied" });

  const r = ok<Applied>(redoSegment(u.world, u.seg, NOW));
  assertEquals(r.world.subscriptions.map((s) => s.items), applied.world.subscriptions.map((s) => s.items));
  assertEquals(r.world.tasks.map((t) => t.taskTypeId), ["B", "B", "X"]);
  assertEquals(r.seg.state, "applied");
  assertEquals(redoSegment(r.world, r.seg, NOW), { ok: false, code: "segment_not_undone" });
});

Deno.test("REQ-927 undoSegment: only the segment's records — a task made on B after the move stays on B; a record edited off B is left alone", () => {
  const applied = ok<Applied>(migrateService(world(), { id: "m1", userId: "u", from: A, toTypeId: "B", now: NOW }));
  applied.world.tasks.push(task("t9", "B"));
  applied.world.checklists[0].items[0].taskTypeId = "X"; // changed by hand since
  const u = ok<Applied>(undoSegment(applied.world, applied.seg, NOW));
  assertEquals(u.world.tasks.find((t) => t.id === "t9")!.taskTypeId, "B");
  assertEquals(u.world.checklists[0].items[0].taskTypeId, "X");
  assert(!u.changed.checklists.includes("k1"));
});

Deno.test("REQ-927 moveSegment: the segment's records go on to C — from applied (B → C) or from undone (A → C); the marks still say 'was A'", () => {
  const applied = ok<Applied>(migrateService(world(), { id: "m1", userId: "u", from: A, toTypeId: "B", now: NOW }));
  const m = ok<Applied>(moveSegment(applied.world, applied.seg, "C", NOW));
  const s1 = m.world.subscriptions.find((s) => s.id === "s1")!;
  assertEquals(s1.items[0], { taskTypeId: "C", priceCents: 4000, migratedFrom: [{ typeId: "A", migrationId: "m1" }] });
  // s2's A row was merged into B; moving the segment pulls the A row (not s2's own B) out to C
  // (at the row's own place again)
  assertEquals(m.world.subscriptions.find((s) => s.id === "s2")!.items, [{
    taskTypeId: "C",
    priceCents: 3000,
    migratedFrom: [{ typeId: "A", migrationId: "m1" }],
  }, { taskTypeId: "B", priceCents: 2500 }]);
  assertEquals(m.world.tasks.map((t) => t.taskTypeId), ["C", "C", "X"]);
  assertEquals(m.world.crews.map((c) => c.taskTypeIds), [["X", "C"], ["B"]]);
  assertEquals([m.seg.toTypeId, m.seg.state, m.seg.history.map((h) => h.action)], ["C", "applied", ["migrate", "move"]]);
  // undo after the move goes back to A
  const u = ok<Applied>(undoSegment(m.world, m.seg, NOW));
  const byType = (s: Subscription) => [...s.items].sort((a, b) => a.taskTypeId.localeCompare(b.taskTypeId));
  assertEquals(u.world.subscriptions.map(byType), world().subscriptions.map(byType));

  const fromUndone = ok<Applied>(moveSegment(u.world, u.seg, "D", NOW));
  assertEquals(fromUndone.world.tasks.map((t) => t.taskTypeId), ["D", "D", "X"]);
  assertEquals(moveSegment(fromUndone.world, fromUndone.seg, "D", NOW), { ok: false, code: "same_service" });
  assertEquals(moveSegment(fromUndone.world, fromUndone.seg, "A", NOW), { ok: false, code: "same_service" });
});

Deno.test("REQ-927 undoSegment: a segment whose records were migrated again since is refused until the later one is undone", () => {
  const B: TaskType = { id: "B", userId: "u", name: "Lawn cut", createdAt: NOW };
  const m1 = ok<Applied>(migrateService(world(), { id: "m1", userId: "u", from: A, toTypeId: "B", now: NOW }));
  const m2 = ok<Applied>(migrateService(m1.world, { id: "m2", userId: "u", from: B, toTypeId: "C", now: NOW }));
  assertEquals(m2.world.tasks[0].migratedFrom, [{ typeId: "A", migrationId: "m1" }, { typeId: "B", migrationId: "m2" }]);
  assertEquals(undoSegment(m2.world, m1.seg, NOW), { ok: false, code: "segment_superseded", detail: { migrationId: "m2" } });
  const u2 = ok<Applied>(undoSegment(m2.world, m2.seg, NOW));
  const u1 = ok<Applied>(undoSegment(u2.world, m1.seg, NOW));
  assertEquals(u1.world.tasks.map((t) => t.taskTypeId), ["A", "A", "X"]);
});
