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

  register(fn: WorkOrderWorkerFn): void {
    this.fn = fn;
  }

  async find(
    workerId: string,
    userId: string,
  ): Promise<WorkOrderWorker | null> {
    if (!this.fn) return null;
    return await this.fn(workerId, userId);
  }
}
