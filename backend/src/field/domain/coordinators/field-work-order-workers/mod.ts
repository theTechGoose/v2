/**
 * REQ-1010 (LOOP-007 q1-96) — a work order is assigned to one of the account's
 * field workers. This registers on paperwork's WorkOrderWorkerPort at boot, so
 * the work-order controller can refuse a worker of another account and take the
 * worker's name as the Assignee shown.
 */
import { Injectable } from "#danet/core";
import { FieldWorkerStore } from "@field/domain/data/field-stores/mod.ts";
import {
  type WorkOrderWorker,
  WorkOrderWorkerPort,
} from "@paperwork/domain/coordinators/work-order-worker-port/mod.ts";

@Injectable()
export class FieldWorkOrderWorkers {
  constructor(
    private workers: FieldWorkerStore,
    // optional so a hand-built coordinator runs without it
    port?: WorkOrderWorkerPort,
  ) {
    port?.register((workerId, userId) => this.find(workerId, userId));
  }

  async find(
    workerId: string,
    userId: string,
  ): Promise<WorkOrderWorker | null> {
    const w = await this.workers.find(workerId);
    return w && w.userId === userId ? { id: w.id, name: w.name } : null;
  }
}
