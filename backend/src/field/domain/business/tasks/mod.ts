/**
 * REQ-139/141 — task types; the day's tasks: one per (due active subscription
 * × item) in every zone that has a worker, idempotent per day; what a worker
 * may see and do. Pure.
 */
import type { FieldTask, FieldWorker, Region, Subscription, TaskType } from "@field/dto/field.ts";
import { CAP } from "@field/dto/field.ts";
import { isDue } from "@field/domain/business/schedule/mod.ts";

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function searchTaskTypes(types: TaskType[], q: string): TaskType[] {
  const needle = fold(q);
  if (!needle) return types;
  return types.filter((t) => fold(t.name).includes(needle));
}

/** pick the existing type by name (any case, any accents) or make a new one */
export function findOrCreateTaskType(types: TaskType[], name: string, userId: string, newId: () => string): { type: TaskType; created: boolean } {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, CAP.taskType);
  const existing = types.find((t) => fold(t.name) === fold(clean));
  if (existing) return { type: existing, created: false };
  return { type: { id: newId(), userId, name: clean, createdAt: new Date().toISOString() }, created: true };
}

/** the due subscriptions on `date` whose zone has no worker — reported, never silently dropped */
export function unstaffed(input: { date: string; subscriptions: Subscription[]; regions: Region[] }): Subscription[] {
  const staffed = new Set(input.regions.filter((r) => r.workerId).map((r) => r.id));
  return input.subscriptions.filter((s) => s.active && isDue(s, input.date) && (!s.regionId || !staffed.has(s.regionId)));
}

export function generateTasks(input: {
  userId: string;
  date: string;
  subscriptions: Subscription[];
  regions: Region[];
  existing: FieldTask[];
  newId: () => string;
}): FieldTask[] {
  const workerOf = new Map(input.regions.filter((r) => r.workerId).map((r) => [r.id, r.workerId!]));
  const have = new Set(input.existing.map((t) => `${t.subscriptionId}|${t.taskTypeId}|${t.date}`));
  const out: FieldTask[] = [];
  for (const s of input.subscriptions) {
    if (!s.active || !s.regionId || !isDue(s, input.date)) continue;
    const workerId = workerOf.get(s.regionId);
    if (!workerId) continue;
    for (const item of s.items) {
      const key = `${s.id}|${item.taskTypeId}|${input.date}`;
      if (have.has(key)) continue;
      have.add(key);
      out.push({
        id: input.newId(), userId: input.userId, subscriptionId: s.id, taskTypeId: item.taskTypeId, customerId: s.customerId,
        regionId: s.regionId, workerId, date: input.date, address: s.address, priceCents: item.priceCents, status: "assigned",
      });
    }
  }
  return out;
}

/** push a service to the next day: the original is marked, a copy holds tomorrow's slot */
export function deferTask(t: FieldTask, to: string, note: string | undefined, newId: () => string): { copy: FieldTask } {
  t.status = "deferred";
  t.deferredTo = to;
  if (note) t.note = note;
  const { id: _i, status: _s, note: _n, completedAt: _c, deferredTo: _d, deferredFrom: _f, invoiceId: _v, ...rest } = t;
  const copy: FieldTask = { ...rest, id: newId(), date: to, status: "assigned", deferredFrom: t.date };
  return { copy };
}

export type WorkerTaskView = Omit<FieldTask, "priceCents" | "invoiceId" | "adminNote"> & { locked: boolean };

/** what a worker is allowed to see of a task — no price, no invoice, no office note */
export function workerView(t: FieldTask): WorkerTaskView {
  const { priceCents: _p, invoiceId, adminNote: _a, ...rest } = t;
  return { ...rest, locked: !!invoiceId };
}

/** how far back a worker may act — today and two days before; a foreman two weeks */
export function inActionWindow(w: FieldWorker, taskDate: string, todayIso: string): boolean {
  if (taskDate > todayIso) return false;
  const days = Math.round((Date.parse(todayIso + "T00:00:00Z") - Date.parse(taskDate + "T00:00:00Z")) / 86_400_000);
  return days <= (w.role === "foreman" ? 14 : 2);
}

/** a worker touches their own tasks; a foreman anyone's */
export const canAct = (w: FieldWorker, t: FieldTask) => w.role === "foreman" || t.workerId === w.id;

export type AddServiceResult = { ok: true; task: FieldTask; restored: boolean } | { ok: false; reason: "no_visit" | "duplicate" | "invoiced" };

/**
 * the worker adds a service to a visit they have that day: priced from the
 * subscription when it lists that type, else $0 and flagged for the office; a
 * removed (skipped) service of the same type is restored instead of duplicated.
 */
export function addService(input: { subscription: Subscription; taskTypeId: string; date: string; existing: FieldTask[]; newId: () => string; addedByName?: string }): AddServiceResult {
  const s = input.subscription;
  const visit = input.existing.filter((t) => t.subscriptionId === s.id && t.date === input.date);
  if (!visit.length) return { ok: false, reason: "no_visit" };
  if (visit.some((t) => t.invoiceId)) return { ok: false, reason: "invoiced" };
  const same = visit.find((t) => t.taskTypeId === input.taskTypeId);
  if (same && same.status !== "skipped") return { ok: false, reason: "duplicate" };
  if (same) {
    same.status = "assigned";
    return { ok: true, task: same, restored: true };
  }
  const item = s.items.find((i) => i.taskTypeId === input.taskTypeId);
  const task: FieldTask = {
    id: input.newId(), userId: s.userId, subscriptionId: s.id, taskTypeId: input.taskTypeId, customerId: s.customerId,
    regionId: visit[0].regionId, workerId: visit[0].workerId, date: input.date, address: visit[0].address ?? s.address,
    priceCents: item?.priceCents ?? 0, status: "assigned", addedBy: "worker", addedByName: input.addedByName,
  };
  return { ok: true, task, restored: false };
}

/** REQ-164 — a one-off task the office makes by hand: no subscription, one day, flagged so nothing automatic touches it */
export function oneOffTask(input: {
  userId: string; customerId: string; date: string; taskTypeId: string; priceCents: number; workerId: string;
  regionId?: string; address?: string; newId: () => string;
}): FieldTask {
  return {
    id: input.newId(), userId: input.userId, subscriptionId: "", oneOff: true, taskTypeId: input.taskTypeId, customerId: input.customerId,
    regionId: input.regionId ?? "", workerId: input.workerId, date: input.date, address: input.address, priceCents: input.priceCents,
    status: "assigned", addedBy: "office",
  };
}

/** the tasks that make up one visit: the subscription's that day — or, for a one-off, the customer's one-offs that day */
export const sameVisit = (t: FieldTask, x: FieldTask) =>
  x.date === t.date && (t.subscriptionId ? x.subscriptionId === t.subscriptionId : !!x.oneOff && x.customerId === t.customerId);

/**
 * REQ-165 — the office adds a service to the visit a task belongs to: a sibling (same customer, day,
 * worker, zone, address, subscription); priced as given, else from the subscription, else $0; the same
 * type already on the visit is a duplicate (a removed one is restored, repriced); an invoiced visit is closed.
 */
export function officeService(input: { task: FieldTask; visit: FieldTask[]; taskTypeId: string; priceCents?: number; subscription?: Subscription; newId: () => string }): AddServiceResult {
  const t = input.task;
  const visit = input.visit.filter((x) => sameVisit(t, x));
  if (visit.some((x) => x.invoiceId)) return { ok: false, reason: "invoiced" };
  const same = visit.find((x) => x.taskTypeId === input.taskTypeId);
  if (same && same.status !== "skipped") return { ok: false, reason: "duplicate" };
  if (same) {
    same.status = "assigned";
    if (input.priceCents !== undefined) same.priceCents = input.priceCents;
    return { ok: true, task: same, restored: true };
  }
  const item = input.subscription?.items.find((i) => i.taskTypeId === input.taskTypeId);
  const task: FieldTask = {
    id: input.newId(), userId: t.userId, subscriptionId: t.subscriptionId, taskTypeId: input.taskTypeId, customerId: t.customerId,
    regionId: t.regionId, workerId: t.workerId, date: t.date, address: t.address, priceCents: input.priceCents ?? item?.priceCents ?? 0,
    status: "assigned", addedBy: "office", ...(t.oneOff ? { oneOff: true as const } : {}),
  };
  return { ok: true, task, restored: false };
}
