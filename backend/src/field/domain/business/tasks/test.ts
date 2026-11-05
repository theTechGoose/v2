/** REQ-139/141 — task types, the day's tasks, and what a worker may do to them. */
import { assert, assertEquals } from "#std/assert";
import { addService, canAct, deferTask, findOrCreateTaskType, generateTasks, inActionWindow, officeService, oneOffTask, searchTaskTypes, unstaffed, workerView } from "./mod.ts";
import type { FieldTask, FieldWorker, Region, Subscription, TaskType } from "@field/dto/field.ts";

let n = 0;
const newId = () => `t${++n}`;
const types: TaskType[] = [{ id: "1", userId: "u", name: "Cortar césped", createdAt: "x" }, { id: "2", userId: "u", name: "Recorte de setos", createdAt: "x" }, { id: "3", userId: "u", name: "Soplado de hojas", createdAt: "x" }];

Deno.test("REQ-139 searchTaskTypes — case- and accent-insensitive", () => {
  assertEquals(searchTaskTypes(types, "CORTAR").map((t) => t.id), ["1"]);
  assertEquals(searchTaskTypes(types, "cesped").map((t) => t.id), ["1"]);
  assertEquals(searchTaskTypes(types, "SeToS").map((t) => t.id), ["2"]);
  assertEquals(searchTaskTypes(types, "").length, 3);
});

Deno.test("REQ-139 findOrCreateTaskType — an unknown name is created, a known one (any case) reused", () => {
  const made = findOrCreateTaskType(types, "Fertilizar", "u", newId);
  assertEquals(made.created, true);
  assertEquals(made.type.userId, "u");
  const reused = findOrCreateTaskType(types, "cortar CÉSPED", "u", newId);
  assertEquals(reused.created, false);
  assertEquals(reused.type.id, "1");
});

const regions: Region[] = [
  { id: "ra", userId: "u", name: "Zona A", color: "#0", lat: 0, lng: 0, workerId: "w1" },
  { id: "rb", userId: "u", name: "Zona B", color: "#0", lat: 0, lng: 0 },
];
const sub = (id: string, regionId: string, o: Partial<Subscription> = {}): Subscription => ({
  id, userId: "u", customerId: "c", address: "a", lat: 0, lng: 0, items: [{ taskTypeId: "1", priceCents: 6500 }, { taskTypeId: "2", priceCents: 4000 }],
  cadence: "weekly", active: true, regionId, startDate: "2026-10-06", createdAt: "2026-10-06", updatedAt: "2026-10-06", ...o, // weekly: due on 10-27
});

Deno.test("REQ-141 generateTasks — the day's tasks go to the worker of each subscription's zone; unstaffed zones and paused subscriptions get none", () => {
  const out = generateTasks({ userId: "u", date: "2026-10-27", subscriptions: [sub("s1", "ra"), sub("s2", "rb"), sub("s3", "ra", { active: false })], regions, existing: [], newId });
  assertEquals(out.length, 2);
  assertEquals(out.every((t) => t.workerId === "w1" && t.subscriptionId === "s1" && t.userId === "u" && t.customerId === "c"), true);
  assertEquals(out.map((t) => t.priceCents), [6500, 4000]);
});

Deno.test("REQ-141 generateTasks — the same day twice adds nothing", () => {
  const first = generateTasks({ userId: "u", date: "2026-10-27", subscriptions: [sub("s1", "ra")], regions, existing: [], newId });
  const second = generateTasks({ userId: "u", date: "2026-10-27", subscriptions: [sub("s1", "ra")], regions, existing: first, newId });
  assertEquals(second.length, 0);
});

Deno.test("REQ-141 generateTasks — only subscriptions due that day, the address snapshotted", () => {
  const weekly = sub("w", "ra", { startDate: "2026-10-05" });
  const bi = sub("b", "ra", { startDate: "2026-10-05", cadence: "biweekly", address: "9 Oak St" });
  const week1 = generateTasks({ userId: "u", date: "2026-10-12", subscriptions: [weekly, bi], regions, existing: [], newId });
  assertEquals(week1.map((t) => t.subscriptionId), ["w", "w"]);
  const week2 = generateTasks({ userId: "u", date: "2026-10-19", subscriptions: [weekly, bi], regions, existing: [], newId });
  assertEquals(week2.filter((t) => t.subscriptionId === "b").length, 2);
  assertEquals(week2.find((t) => t.subscriptionId === "b")!.address, "9 Oak St");
});

Deno.test("REQ-141 unstaffed — the due subscriptions with no worker are reported, not dropped silently", () => {
  const out = unstaffed({ date: "2026-10-12", subscriptions: [sub("w", "ra", { startDate: "2026-10-05" }), sub("u", "rb", { startDate: "2026-10-05" })], regions });
  assertEquals(out.map((s) => s.id), ["u"]);
});

Deno.test("REQ-141 workerView — no price, no invoice id, no office note; locked once invoiced", () => {
  const t: FieldTask = { id: "t", userId: "u", subscriptionId: "s", taskTypeId: "1", customerId: "c", regionId: "ra", workerId: "w1", date: "d", priceCents: 6500, status: "assigned", invoiceId: "i", adminNote: "secret" };
  const v = workerView(t) as Record<string, unknown>;
  assertEquals(["priceCents" in v, "invoiceId" in v, "adminNote" in v, v.locked, v.workerId], [false, false, false, true, "w1"]);
});

const visit = (): FieldTask[] => [
  { id: "v1", userId: "u", subscriptionId: "s1", taskTypeId: "1", customerId: "c", regionId: "ra", workerId: "w1", date: "2026-10-28", priceCents: 6500, status: "assigned" },
];

Deno.test("REQ-141 addService — priced from the subscription when it lists the type, else $0 and flagged", () => {
  const priced = addService({ subscription: sub("s1", "ra"), taskTypeId: "2", date: "2026-10-28", existing: visit(), newId });
  assert(priced.ok);
  assertEquals([priced.task.priceCents, priced.task.workerId, priced.task.addedBy], [4000, "w1", "worker"]);
  const extra = addService({ subscription: sub("s1", "ra"), taskTypeId: "3", date: "2026-10-28", existing: visit(), newId });
  assert(extra.ok);
  assertEquals(extra.task.priceCents, 0);
});

Deno.test("REQ-141 addService — a duplicate is refused; a removed one is restored; no visit that day, no add; an invoiced visit is closed", () => {
  const dup = addService({ subscription: sub("s1", "ra"), taskTypeId: "1", date: "2026-10-28", existing: visit(), newId });
  assertEquals(dup.ok, false);
  const skipped = visit(); skipped[0].status = "skipped";
  const back = addService({ subscription: sub("s1", "ra"), taskTypeId: "1", date: "2026-10-28", existing: skipped, newId });
  assert(back.ok);
  assertEquals([back.restored, back.task.id, skipped[0].status], [true, "v1", "assigned"]);
  const none = addService({ subscription: sub("s1", "ra"), taskTypeId: "2", date: "2026-10-29", existing: visit(), newId });
  assertEquals(none.ok, false);
  const billed = visit(); billed[0].invoiceId = "inv";
  const closed = addService({ subscription: sub("s1", "ra"), taskTypeId: "2", date: "2026-10-28", existing: billed, newId });
  assertEquals(closed.ok === false && closed.reason, "invoiced");
});

Deno.test("REQ-141 generateTasks — the day again does not bring back a removed service", () => {
  const skipped = visit(); skipped[0].status = "skipped";
  const again = generateTasks({ userId: "u", date: "2026-10-28", subscriptions: [sub("s1", "ra", { startDate: "2026-10-28", items: [{ taskTypeId: "1", priceCents: 6500 }] })], regions, existing: skipped, newId });
  assertEquals(again.length, 0);
});

Deno.test("REQ-141 canAct / inActionWindow — own tasks only (a foreman anyone's); today and two days back (a foreman fourteen); never the future", () => {
  const t = visit()[0];
  const w = (id: string, role?: "foreman"): FieldWorker => ({ id, userId: "u", name: id, phoneNumber: "8435550000", pin: "1234", role, createdAt: "x", updatedAt: "x" });
  assertEquals([canAct(w("w1"), t), canAct(w("w2"), t), canAct(w("w3", "foreman"), t)], [true, false, true]);
  assertEquals([inActionWindow(w("w1"), "2026-10-26", "2026-10-28"), inActionWindow(w("w1"), "2026-10-25", "2026-10-28"), inActionWindow(w("w1"), "2026-10-29", "2026-10-28")], [true, false, false]);
  assertEquals([inActionWindow(w("b", "foreman"), "2026-10-14", "2026-10-28"), inActionWindow(w("b", "foreman"), "2026-10-13", "2026-10-28")], [true, false]);
});

Deno.test("REQ-141 deferTask — the original is marked, tomorrow's copy holds the slot, and generating tomorrow does not duplicate it", () => {
  const weekly = sub("w", "ra", { startDate: "2026-10-05" });
  const t: FieldTask = { id: "t1", userId: "u", subscriptionId: "w", taskTypeId: "1", customerId: "c", regionId: "ra", workerId: "w1", date: "2026-10-12", priceCents: 6500, status: "assigned", address: "a" };
  const { copy } = deferTask(t, "2026-10-13", "Portón cerrado", newId);
  assertEquals([t.status, t.note, t.deferredTo], ["deferred", "Portón cerrado", "2026-10-13"]);
  assertEquals([copy.date, copy.status, copy.priceCents, copy.deferredFrom, copy.workerId], ["2026-10-13", "assigned", 6500, "2026-10-12", "w1"]);
  const again = generateTasks({ userId: "u", date: "2026-10-13", subscriptions: [weekly], regions, existing: [t, copy], newId });
  assertEquals(again.filter((x) => x.taskTypeId === "1").length, 0, "the copy already holds tomorrow's slot for that service");
});

// REQ-164 — "when in tasks i need a button to manually add a task as a one off"
Deno.test("REQ-164 oneOffTask — no subscription, flagged oneOff, the office as author; generateTasks leaves it alone", () => {
  const t = oneOffTask({ userId: "u", customerId: "c9", date: "2026-10-27", taskTypeId: "1", priceCents: 12000, workerId: "w1", address: "1 Main St", newId });
  assertEquals([t.subscriptionId, t.oneOff, t.addedBy, t.status, t.regionId, t.priceCents, t.address], ["", true, "office", "assigned", "", 12000, "1 Main St"]);
  const again = generateTasks({ userId: "u", date: "2026-10-27", subscriptions: [sub("s1", "ra", { customerId: "c9" })], regions, existing: [t], newId });
  assert(again.every((x) => x.id !== t.id && x.subscriptionId === "s1"), "the round is generated next to the one-off, never over it");
});

// REQ-165 — "when in tasks i need to be able to add services to a task as a one off."
Deno.test("REQ-165 officeService — a sibling of the visit, priced as given or from the subscription, duplicate refused, removed restored", () => {
  const s = sub("s1", "ra", { items: [{ taskTypeId: "1", priceCents: 6500 }, { taskTypeId: "2", priceCents: 2500 }] });
  const [cut] = generateTasks({ userId: "u", date: "2026-10-27", subscriptions: [s], regions, existing: [], newId });
  const given = officeService({ task: cut, visit: [cut], taskTypeId: "3", priceCents: 4000, subscription: s, newId });
  assert(given.ok);
  assertEquals([given.task.taskTypeId, given.task.priceCents, given.task.addedBy, given.task.subscriptionId, given.task.workerId, given.task.date, given.task.customerId], ["3", 4000, "office", "s1", "w1", "2026-10-27", s.customerId]);
  const fromSub = officeService({ task: cut, visit: [cut], taskTypeId: "2", subscription: s, newId });
  assert(fromSub.ok && fromSub.task.priceCents === 2500, "the subscription's price when none is given");
  const dup = officeService({ task: cut, visit: [cut], taskTypeId: "1", subscription: s, newId });
  assertEquals(dup, { ok: false, reason: "duplicate" });
  const removed = { ...cut, status: "skipped" as const };
  const back = officeService({ task: removed, visit: [removed], taskTypeId: "1", priceCents: 7000, subscription: s, newId });
  assert(back.ok && back.restored && back.task.status === "assigned" && back.task.priceCents === 7000, "a removed service is restored, repriced");
  const one = oneOffTask({ userId: "u", customerId: "c9", date: "2026-10-27", taskTypeId: "1", priceCents: 100, workerId: "w2", newId });
  const sib = officeService({ task: one, visit: [one], taskTypeId: "2", newId });
  assert(sib.ok && sib.task.oneOff === true && sib.task.subscriptionId === "" && sib.task.workerId === "w2" && sib.task.priceCents === 0, "a one-off's sibling is a one-off too, $0 without a price");
});
