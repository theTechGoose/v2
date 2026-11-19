/**
 * REQ-139/141 — task types; the day's tasks: one per (due active subscription
 * × item) in every zone that has a worker, idempotent per day; what a worker
 * may see and do. Pure.
 */
import type { Absence, Crew, FieldTask, FieldWorker, Region, Subscription, TaskType } from "@field/dto/field.ts";
import { CAP } from "@field/dto/field.ts";
import { isDue } from "@field/domain/business/schedule/mod.ts";
import { lastDayOf, onTask } from "@field/domain/business/job-span/mod.ts";
import { type Staff, staffFor, staffOn } from "@field/domain/business/crews/mod.ts"; // REQ-841/842

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function searchTaskTypes(types: TaskType[], q: string): TaskType[] {
  const needle = fold(q);
  if (!needle) return types;
  return types.filter((t) => fold(t.name).includes(needle));
}

/**
 * pick the existing type by name (any case, any accents) or make a new one. REQ-839: an ARCHIVED
 * type typed again comes back un-archived (`restored`) — the caller saves it, as it saves a created one.
 */
export function findOrCreateTaskType(types: TaskType[], name: string, userId: string, newId: () => string): { type: TaskType; created: boolean; restored?: true } {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, CAP.taskType);
  const existing = types.find((t) => fold(t.name) === fold(clean));
  if (existing?.archived) {
    const { archived: _a, ...rest } = existing;
    return { type: { ...rest, updatedAt: new Date().toISOString() }, created: false, restored: true };
  }
  if (existing) return { type: existing, created: false };
  return { type: { id: newId(), userId, name: clean, createdAt: new Date().toISOString() }, created: true };
}

/** REQ-839: the types a combobox offers — not the archived ones */
export const liveTypes = (types: TaskType[]): TaskType[] => types.filter((t) => !t.archived);

/** REQ-839: is the name (any case) another type's than `exceptId`? */
export function taskTypeNameTaken(types: Pick<TaskType, "id" | "name">[], name: string, exceptId?: string): boolean {
  const needle = fold(name);
  return types.some((t) => t.id !== exceptId && fold(t.name) === needle);
}

/** REQ-839: where a type is used — the repeat visits, checklists and tasks on it */
export function taskTypeUsage(
  taskTypeId: string,
  of: { subscriptions: { items: { taskTypeId: string; priceCents?: number }[] }[]; checklists: { items: { taskTypeId: string; priceCents?: number }[] }[]; tasks: { taskTypeId: string }[] },
): { subscriptions: number; checklists: number; tasks: number } {
  const has = (x: { items: { taskTypeId: string }[] }) => x.items.some((i) => i.taskTypeId === taskTypeId);
  return {
    subscriptions: of.subscriptions.filter(has).length,
    checklists: of.checklists.filter(has).length,
    tasks: of.tasks.filter((t) => t.taskTypeId === taskTypeId).length,
  };
}

/** what the day's round needs besides the visits and zones — REQ-841/842: the crews, the workers, who is out */
export interface RoundStaff {
  crews?: Crew[];
  workers?: FieldWorker[];
  absences?: Absence[];
}

/**
 * REQ-841: the due visits on `date` with the services nobody on their zone does — the whole
 * visit when its zone has no staff at all. Reported, never silently dropped.
 */
export function uncovered(input: { date: string; subscriptions: Subscription[]; regions: Region[] } & RoundStaff): { subscription: Subscription; taskTypeIds: string[] }[] {
  const crews = input.crews ?? [], workers = input.workers ?? [];
  const out: { subscription: Subscription; taskTypeIds: string[] }[] = [];
  for (const s of input.subscriptions) {
    if (!s.active || !isDue(s, input.date)) continue;
    const region = s.regionId ? input.regions.find((r) => r.id === s.regionId) : undefined;
    const missing = s.items.filter((i) => !region || !staffFor({ region, taskTypeId: i.taskTypeId, crews, workers })).map((i) => i.taskTypeId);
    if (missing.length) out.push({ subscription: s, taskTypeIds: missing });
  }
  return out;
}

/** the due subscriptions on `date` with a service nobody covers (REQ-141: the zone has no worker) */
export function unstaffed(input: { date: string; subscriptions: Subscription[]; regions: Region[] } & RoundStaff): Subscription[] {
  return uncovered(input).map((u) => u.subscription);
}

/** the fields that say who does a task — a crew's lead and members, or one worker */
function assignment(staff: Staff): Pick<FieldTask, "workerId" | "crewIds" | "crewId"> {
  if (staff.kind === "worker") return { workerId: staff.workerId };
  return { workerId: staff.lead.id, crewId: staff.crew.id, ...(staff.crewIds.length ? { crewIds: staff.crewIds } : {}) };
}

/**
 * REQ-141: one task per (due active visit × service), in the zones that have staff. REQ-841: the
 * staff is per service — the zone's crew that does it (its foreman leads, the members are the crew),
 * else the zone's worker. REQ-842: someone out → cover (`coverFor`), defer (the task is `deferred`
 * and a COPY — a later `date` — holds the day they are back) or skip (`skipped`). Idempotent per day.
 */
export function generateTasks(input: {
  userId: string;
  date: string;
  subscriptions: Subscription[];
  regions: Region[];
  existing: FieldTask[];
  newId: () => string;
} & RoundStaff): FieldTask[] {
  const crews = input.crews ?? [], workers = input.workers ?? [], absences = input.absences ?? [];
  const have = new Set(input.existing.map((t) => `${t.subscriptionId}|${t.taskTypeId}|${t.date}`));
  const out: FieldTask[] = [];
  for (const s of input.subscriptions) {
    if (!s.active || !s.regionId || !isDue(s, input.date)) continue;
    const region = input.regions.find((r) => r.id === s.regionId);
    if (!region) continue;
    for (const item of s.items) {
      const key = `${s.id}|${item.taskTypeId}|${input.date}`;
      if (have.has(key)) continue;
      const r = staffOn({ region, taskTypeId: item.taskTypeId, crews, workers, absences, date: input.date });
      if (!r) continue;
      have.add(key);
      const base = {
        id: input.newId(), userId: input.userId, subscriptionId: s.id, taskTypeId: item.taskTypeId, customerId: s.customerId,
        regionId: s.regionId, date: input.date, address: s.address, priceCents: item.priceCents,
      };
      if (r.kind === "staff") out.push({ ...base, ...assignment(r.staff), status: "assigned" });
      else if (r.kind === "cover") out.push({ ...base, ...assignment(r.staff), status: "assigned", coverFor: r.coverFor, byAbsence: r.absence.id });
      else if (r.kind === "skip" || !r.to) out.push({ ...base, ...assignment(r.staff), status: "skipped", byAbsence: r.absence.id });
      else {
        out.push({ ...base, ...assignment(r.staff), status: "deferred", deferredTo: r.to, byAbsence: r.absence.id });
        const then = staffOn({ region, taskTypeId: item.taskTypeId, crews, workers, absences, date: r.to });
        const who = then && then.kind !== "skip" && then.kind !== "defer" ? then.staff : r.staff;
        out.push({ ...base, id: input.newId(), ...assignment(who), date: r.to, status: "assigned", deferredFrom: input.date, byAbsence: r.absence.id });
      }
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

/** REQ-401: why a task is locked — on a draft invoice not sent yet, or invoiced (sent or later) */
export type LockState = "draft" | "invoiced" | null;
export type WorkerTaskView = Omit<FieldTask, "priceCents" | "invoiceId" | "adminNote"> & { locked: boolean; lockState: LockState };

/**
 * what a worker is allowed to see of a task — no price, no invoice, no office note.
 * `invoiceStatus` is the status of the task's invoice (when known): a draft is only
 * "on a draft invoice" (REQ-401, demo m45); anything else — or unknown — is "invoiced".
 */
export function workerView(t: FieldTask, invoiceStatus?: string): WorkerTaskView {
  const { priceCents: _p, invoiceId, adminNote: _a, ...rest } = t;
  const lockState: LockState = !invoiceId ? null : invoiceStatus === "draft" ? "draft" : "invoiced";
  return { ...rest, locked: !!invoiceId, lockState };
}

/**
 * how far back a worker may act — today and two days before; a foreman two weeks. REQ-785: a
 * multi-day job counts back from its LAST day (`lastDay`), and from its first day it is today's.
 */
export function inActionWindow(w: FieldWorker, taskDate: string, todayIso: string, lastDay = taskDate): boolean {
  if (taskDate > todayIso) return false;
  const end = lastDay < todayIso ? lastDay : todayIso;
  const days = Math.round((Date.parse(todayIso + "T00:00:00Z") - Date.parse(end + "T00:00:00Z")) / 86_400_000);
  return days <= (w.role === "foreman" ? 14 : 2);
}

/** a worker touches their own tasks (REQ-785: a job's crew too); a foreman anyone's */
export const canAct = (w: FieldWorker, t: FieldTask) => w.role === "foreman" || onTask(w.id, t);

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

/**
 * REQ-164 — a one-off task the office makes by hand: no subscription, flagged so nothing automatic touches it.
 * REQ-785 — one day, or a job of several (`endDate`, its last day) with more workers (`crewIds`).
 */
export function oneOffTask(input: {
  userId: string; customerId: string; date: string; taskTypeId: string; priceCents: number; workerId: string;
  regionId?: string; address?: string; endDate?: string; crewIds?: string[]; newId: () => string;
}): FieldTask {
  return {
    id: input.newId(), userId: input.userId, subscriptionId: "", oneOff: true, taskTypeId: input.taskTypeId, customerId: input.customerId,
    regionId: input.regionId ?? "", workerId: input.workerId, date: input.date, address: input.address, priceCents: input.priceCents,
    status: "assigned", addedBy: "office",
    ...(input.endDate && input.endDate > input.date ? { endDate: input.endDate } : {}),
    ...(input.crewIds?.length ? { crewIds: [...input.crewIds] } : {}),
  };
}

/**
 * the tasks that make up one visit: the subscription's that day — or, for a one-off, the customer's one-offs that
 * day; REQ-785: a job of several days is its own visit (the same first AND last day)
 */
export const sameVisit = (t: FieldTask, x: FieldTask) =>
  x.date === t.date && (t.subscriptionId ? x.subscriptionId === t.subscriptionId : !!x.oneOff && x.customerId === t.customerId && lastDayOf(x) === lastDayOf(t));

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
    // REQ-785: a service added to a job of several days runs the same days, with the same crew
    ...(t.endDate ? { endDate: t.endDate } : {}), ...(t.crewIds?.length ? { crewIds: [...t.crewIds] } : {}),
  };
  return { ok: true, task, restored: false };
}

/**
 * REQ-1162 (LOOP-007 q3-94) — a worker's upcoming open work: tasks still "assigned" to them
 * (as the lead or one of the job's crewIds) that end today or later. Removing the worker
 * would leave each under Worker "—" with status ASSIGNED, so DELETE /field/workers refuses
 * while any is left. Earliest first.
 */
export function upcomingTasksOf(tasks: FieldTask[], workerId: string, today: string): FieldTask[] {
  return tasks
    .filter((t) => !t.deleted && t.status === "assigned" && lastDayOf(t) >= today && (t.workerId === workerId || !!t.crewIds?.includes(workerId)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** REQ-1162 — how the refusal and the /field/workers row describe that work: a count, the days, the customers */
export function upcomingTasksDetail(tasks: FieldTask[], customer: (id: string) => string): { count: number; dates: string[]; customers: string[] } {
  return {
    count: tasks.length,
    dates: [...new Set(tasks.map((t) => t.date))],
    customers: [...new Set(tasks.map((t) => customer(t.customerId)))],
  };
}
