/**
 * REQ-1010 (LOOP-007 q1-96) — a work order (REQ-210) assigned to one of the account's
 * field workers lists on that worker's /worker day, the day it is scheduled for. It is
 * read straight off the work order (no field task is made), so moving its date,
 * reassigning or cancelling it moves or removes it. The worker's row carries no price
 * and nothing the office keeps for itself (notes); it is read-only on the worker's
 * screen — the office runs the work order.
 */
import type { WorkOrder } from "@paperwork/dto/work-order.ts";
import { docNumberOf } from "#documents/numbering.ts";
import {
  coverStaff,
  type DayPeople,
  isOut,
  MAX_DEFER_DAYS,
  type Resolution,
  type Staff,
} from "@field/domain/business/crews/mod.ts";
import { shiftDate } from "@field/domain/business/schedule/mod.ts";
import type { Absence } from "@field/dto/field.ts";

/** what the worker's screen gets of a work order */
export interface WorkOrderDayRow {
  id: string;
  workOrderId: string;
  workOrderNumber: string;
  subscriptionId: "";
  taskTypeId: "";
  /** what to do — the work order's description */
  taskTypeName: string;
  customerId: string;
  customerName: string;
  regionId: "";
  workerId: string;
  workerName: string;
  date: string;
  address?: string;
  status: "assigned" | "complete";
  locked: false;
  lockState: null;
  /** REQ-1022: a crew covering the absent assignee — the crew and its other workers */
  crewId?: string;
  crewIds?: string[];
  crewNames?: string[];
  /** REQ-1022: the absent assignee this worker covers for */
  coverForName?: string;
  /** REQ-1163: the assignee was out on the scheduled day and the work is deferred to this one — the day it was scheduled */
  deferredFrom?: string;
  /** REQ-1163: the assignee is out on this day and nothing moved it (skip, or a defer with no day back) — the office reschedules */
  out?: "defer" | "skip";
}

/** the absence that has the WO's assignee out on `date` — their own, else their crew's */
function assigneeOut(
  workerId: string,
  input: DayPeople,
  date = input.date,
): Absence | undefined {
  const crewId = input.workers.find((w) => w.id === workerId)?.crewId;
  return isOut(input.absences, { workerId }, date) ??
    (crewId ? isOut(input.absences, { crewId }, date) : undefined);
}

/**
 * REQ-1022 (LOOP-007 q2-12, amends REQ-842 / REQ-1010) — who does the work order on `input.date`,
 * resolved at read time like a field task's staff (crews/mod.ts staffOn): the assignee when they
 * are not out; out (their own absence or their crew's) → the absence's disposition: cover (the
 * named worker, or the named crew's lead + available members; null when the cover is out too),
 * defer (flag + the next day the assignee is back) or skip (flag). The WO itself is never touched —
 * a defer or skip only flags it for the office to reschedule. Null: nobody (no assignee, or an
 * uncovered cover).
 */
export function woStaffOn(
  wo: WorkOrder,
  input: DayPeople,
): Resolution | null {
  const workerId = wo.assigneeWorkerId;
  if (!workerId) return null;
  const usual: Staff = { kind: "worker", workerId };
  const out = assigneeOut(workerId, input);
  if (!out) return { kind: "staff", staff: usual };
  if (out.disposition === "cover") {
    const staff = coverStaff(out, input);
    return staff
      ? { kind: "cover", staff, coverFor: workerId, absence: out }
      : null;
  }
  if (out.disposition === "defer") {
    let to: string | null = null;
    for (let i = 1, d = input.date; i <= MAX_DEFER_DAYS; i++) {
      d = shiftDate(d, 1);
      if (!assigneeOut(workerId, input, d)) {
        to = d;
        break;
      }
    }
    return { kind: "defer", to, staff: usual, absence: out };
  }
  return { kind: "skip", staff: usual, absence: out };
}

/** who a work order is on the day of — REQ-1022: the cover when the assignee is out and covered */
export interface WorkOrderDayStaff {
  /** the worker (a covering crew's lead) */
  workerId: string;
  /** a covering crew and its other available workers */
  crewId?: string;
  crewIds?: string[];
  /** the absent assignee covered for */
  coverFor?: string;
}

/**
 * REQ-1022: the staff a work order is on the worker day of. A cover moves it to the cover; a
 * defer / skip leaves it flagged with the (absent) assignee — never silently moved or dropped;
 * an uncovered cover (the cover is out too) puts it on nobody's day (null).
 */
export function woDayStaff(
  wo: WorkOrder,
  input: DayPeople,
): WorkOrderDayStaff | null {
  return dayStaffOf(woStaffOn(wo, input));
}

/** a resolution's staff as the worker day keeps it */
function dayStaffOf(r: Resolution | null): WorkOrderDayStaff | null {
  if (!r) return null;
  const s = r.staff;
  const base: WorkOrderDayStaff = s.kind === "worker"
    ? { workerId: s.workerId }
    : { workerId: s.lead.id, crewId: s.crew.id, crewIds: s.crewIds };
  return r.kind === "cover" ? { ...base, coverFor: r.coverFor } : base;
}

/**
 * REQ-1163 (LOOP-007 q3-96, amends REQ-1022) — where a work order sits on the worker days, resolved
 * at read time (the stored WO is never touched): its scheduled day with its staff (the assignee,
 * or the cover); the assignee out with **defer** and back within MAX_DEFER_DAYS → the first day
 * back, with the assignee, `deferredFrom` = the scheduled day (and off the day out); **skip**, or a
 * defer with no day back → the scheduled day, flagged `out` for the office to reschedule. `staff`
 * null: nobody has it (an uncovered cover). Null: not on any worker day (no assignee, no date,
 * cancelled).
 */
export interface WorkOrderPlacement {
  date: string;
  staff: WorkOrderDayStaff | null;
  deferredFrom?: string;
  out?: "defer" | "skip";
}

export function woDayPlacement(
  wo: WorkOrder,
  people: Omit<DayPeople, "date">,
): WorkOrderPlacement | null {
  if (!wo.assigneeWorkerId || !wo.scheduledFor || wo.status === "cancelled") {
    return null;
  }
  const date = wo.scheduledFor;
  const r = woStaffOn(wo, { ...people, date });
  if (!r) return { date, staff: null };
  const staff = dayStaffOf(r);
  if (r.kind === "defer" && r.to) {
    return { date: r.to, staff, deferredFrom: date };
  }
  if (r.kind === "defer" || r.kind === "skip") {
    return { date, staff, out: r.kind };
  }
  return { date, staff };
}

/** REQ-1163: the work orders placed on `date` (a deferred one on the day its assignee is back), each with its placement */
export function workOrdersPlacedOn(
  rows: WorkOrder[],
  date: string,
  people: Omit<DayPeople, "date">,
): { wo: WorkOrder; place: WorkOrderPlacement }[] {
  return rows.flatMap((wo) => {
    const place = woDayPlacement(wo, people);
    return place && place.date === date ? [{ wo, place }] : [];
  });
}

/** the workers on a day's staff */
const staffIds = (s: WorkOrderDayStaff) => [s.workerId, ...(s.crewIds ?? [])];

/**
 * the work order is on `workerId`'s day `date`: assigned to them, scheduled that day, not
 * cancelled. REQ-1022: given the day's people (absences), on the resolved staff's day instead;
 * REQ-1163: a deferred one on the day its assignee is back, not the day out.
 */
export function onWorkOrderDay(
  wo: WorkOrder,
  workerId: string,
  date: string,
  people?: Omit<DayPeople, "date">,
): boolean {
  if (!people) {
    return wo.scheduledFor === date && wo.status !== "cancelled" &&
      wo.assigneeWorkerId === workerId;
  }
  const p = woDayPlacement(wo, people);
  return !!p && p.date === date && !!p.staff &&
    staffIds(p.staff).includes(workerId);
}

/** the work orders scheduled on `date` for any worker (a foreman's whole day), not cancelled */
export function workOrdersOn(rows: WorkOrder[], date: string): WorkOrder[] {
  return rows.filter((wo) =>
    !!wo.assigneeWorkerId && wo.scheduledFor === date &&
    wo.status !== "cancelled"
  );
}

/** the worker's row for a work order — no price, no office notes */
export function workOrderRow(
  wo: WorkOrder,
  names: { customer: (id: string) => string; worker: (id: string) => string },
  staff: WorkOrderDayStaff = { workerId: wo.assigneeWorkerId! },
  place?: Pick<WorkOrderPlacement, "date" | "deferredFrom" | "out">,
): WorkOrderDayRow {
  // the customer's current name ("—" when unknown), else the name it had when filed, else the WO's number
  const live = wo.customerId ? names.customer(wo.customerId) : "—";
  const customerName = live !== "—"
    ? live
    : wo.customerSnapshot?.name || docNumberOf(wo);
  return {
    id: `wo:${wo.id}`,
    workOrderId: wo.id,
    workOrderNumber: docNumberOf(wo),
    subscriptionId: "",
    taskTypeId: "",
    taskTypeName: wo.description,
    customerId: wo.customerId ?? "",
    customerName,
    regionId: "",
    workerId: staff.workerId,
    workerName: names.worker(staff.workerId),
    date: place?.date ?? wo.scheduledFor!,
    ...(wo.serviceAddress ? { address: wo.serviceAddress } : {}),
    status: wo.status === "done" ? "complete" : "assigned",
    locked: false,
    lockState: null,
    ...(staff.crewId ? { crewId: staff.crewId } : {}),
    ...(staff.crewIds?.length
      ? {
        crewIds: staff.crewIds,
        crewNames: staff.crewIds.map((id) => names.worker(id)),
      }
      : {}),
    ...(staff.coverFor ? { coverForName: names.worker(staff.coverFor) } : {}),
    ...(place?.deferredFrom ? { deferredFrom: place.deferredFrom } : {}),
    ...(place?.out ? { out: place.out } : {}),
  };
}
