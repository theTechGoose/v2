import { Injectable } from "#danet/core";

/** the account's field worker a work order is assigned to */
export interface WorkOrderWorker {
  id: string;
  name: string;
}

export type WorkOrderWorkerFn = (
  workerId: string,
  userId: string,
) => Promise<WorkOrderWorker | null>;

/**
 * REQ-1022 — a work order's assignee marked out on its scheduled day (Field's REQ-842 absence):
 * `coverAssignee` the cover's name (a worker, or a crew's name); else `assigneeOut` — the absence
 * defers or skips their work ("defer" / "skip"), or names a cover who is out too ("uncovered").
 * Empty when the assignee is there (or the WO has no assignee / day).
 */
export interface WorkOrderCover {
  coverAssignee?: string;
  assigneeOut?: "defer" | "skip" | "uncovered";
}

/** the day's absence resolution of each work order `{ assigneeWorkerId, scheduledFor }`, in order */
export type WorkOrderCoverFn = (
  userId: string,
  rows: { assigneeWorkerId?: string; scheduledFor?: string; status?: string }[],
) => Promise<WorkOrderCover[]>;

/**
 * REQ-1010 (LOOP-007 q1-96) — the paperwork side's door to Field's workers. A
 * work order's Assignee is one of the account's field workers, so it lists on
 * that worker's /worker day; but the FieldWorker model lives in the Field
 * module, and Field imports paperwork (not the other way round). Field's
 * FieldWorkOrderWorkers registers itself here at boot (the REQ-497 / REQ-699
 * port pattern), and the work-order controller asks it without knowing Field.
 *
 * `find` answers the worker when it is one of `userId`'s, else null — and null
 * when nothing registered (paperwork booted alone), so an id that can't be
 * checked is never stored.
 */
@Injectable()
export class WorkOrderWorkerPort {
  private fn?: WorkOrderWorkerFn;
  private coverFn?: WorkOrderCoverFn;

  register(fn: WorkOrderWorkerFn, cover?: WorkOrderCoverFn): void {
    this.fn = fn;
    if (cover) this.coverFn = cover;
  }

  /** REQ-1022: who covers each WO's absent assignee — nothing known when Field never registered */
  async coversOf(
    userId: string,
    rows: {
      assigneeWorkerId?: string;
      scheduledFor?: string;
      status?: string;
    }[],
  ): Promise<WorkOrderCover[]> {
    if (!this.coverFn || rows.length === 0) return rows.map(() => ({}));
    return await this.coverFn(userId, rows);
  }

  async find(
    workerId: string,
    userId: string,
  ): Promise<WorkOrderWorker | null> {
    if (!this.fn) return null;
    return await this.fn(workerId, userId);
  }
}
