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
}

/** the work order is on `workerId`'s day `date`: assigned to them, scheduled that day, not cancelled */
export function onWorkOrderDay(
  wo: WorkOrder,
  workerId: string,
  date: string,
): boolean {
  return wo.assigneeWorkerId === workerId && wo.scheduledFor === date &&
    wo.status !== "cancelled";
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
    workerId: wo.assigneeWorkerId!,
    workerName: names.worker(wo.assigneeWorkerId!),
    date: wo.scheduledFor!,
    ...(wo.serviceAddress ? { address: wo.serviceAddress } : {}),
    status: wo.status === "done" ? "complete" : "assigned",
    locked: false,
    lockState: null,
  };
}
