/**
 * REQ-1010 (LOOP-007 q1-96) — a work order is assigned to one of the account's
 * field workers. This registers on paperwork's WorkOrderWorkerPort at boot, so
 * the work-order controller can refuse a worker of another account and take the
 * worker's name as the Assignee shown.
 *
 * REQ-1022 (LOOP-007 q2-12) — and it answers who covers a work order whose assignee is marked
 * out on its day (REQ-842's absence, resolved by work-order-day's woStaffOn), so /work-orders
 * shows "covered by Miguel Torres" (or that the assignee is out) instead of the absent worker.
 */
import { Injectable } from "#danet/core";
import {
  AbsenceStore,
  CrewStore,
  FieldWorkerStore,
} from "@field/domain/data/field-stores/mod.ts";
import {
  type WorkOrderCover,
  type WorkOrderWorker,
  WorkOrderWorkerPort,
} from "@paperwork/domain/coordinators/work-order-worker-port/mod.ts";
import { woStaffOn } from "@field/domain/business/work-order-day/mod.ts";
import type { WorkOrder } from "@paperwork/dto/work-order.ts";

@Injectable()
export class FieldWorkOrderWorkers {
  constructor(
    private workers: FieldWorkerStore,
    private absences: AbsenceStore, // REQ-1022
    private crews: CrewStore, // REQ-1022
    // optional so a hand-built coordinator runs without it
    port?: WorkOrderWorkerPort,
  ) {
    port?.register(
      (workerId, userId) => this.find(workerId, userId),
      (userId, rows) => this.covers(userId, rows),
    );
  }

  /** REQ-1022: each work order's cover (or out flag) on its scheduled day */
  async covers(
    userId: string,
    rows: {
      assigneeWorkerId?: string;
      scheduledFor?: string;
      status?: string;
    }[],
  ): Promise<WorkOrderCover[]> {
    if (!rows.some((r) => r.assigneeWorkerId && r.scheduledFor)) {
      return rows.map(() => ({}));
    }
    const [absences, workers, crews] = await Promise.all([
      this.absences.listByUser(userId),
      this.workers.listByUser(userId),
      this.crews.listByUser(userId),
    ]);
    const name = new Map(workers.map((w) => [w.id, w.name]));
    return rows.map((wo): WorkOrderCover => {
      if (
        !wo.assigneeWorkerId || !wo.scheduledFor || wo.status === "cancelled"
      ) return {};
      const r = woStaffOn(wo as WorkOrder, {
        absences,
        workers,
        crews,
        date: wo.scheduledFor,
      });
      if (!r) return { assigneeOut: "uncovered" };
      if (r.kind === "cover") {
        return {
          coverAssignee: r.staff.kind === "crew"
            ? r.staff.crew.name
            : name.get(r.staff.workerId) ?? "—",
        };
      }
      // REQ-1163: a defer with a day back says which day it sits on
      if (r.kind === "defer" && r.to) {
        return { assigneeOut: "defer", assigneeDeferredTo: r.to };
      }
      return r.kind === "staff" ? {} : { assigneeOut: r.kind };
    });
  }

  async find(
    workerId: string,
    userId: string,
  ): Promise<WorkOrderWorker | null> {
    const w = await this.workers.find(workerId);
    return w && w.userId === userId ? { id: w.id, name: w.name } : null;
  }
}
