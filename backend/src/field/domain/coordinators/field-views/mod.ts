/** The names the pages show next to ids — customers (CustomerStore), types, workers, zones. */
import { Injectable } from "#danet/core";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { FieldWorkerStore, RegionStore, SubscriptionStore, TaskTypeStore } from "@field/domain/data/field-stores/mod.ts";
import { scheduleText } from "@field/domain/business/schedule/mod.ts";
import { workerView } from "@field/domain/business/tasks/mod.ts";
import type { FieldTask, FieldWorker, Region, Subscription } from "@field/dto/field.ts";

export interface Names {
  customer: (id: string) => string;
  type: (id: string) => string;
  worker: (id: string) => string;
  region: (id: string | undefined) => Region | null;
}

export const safeWorker = ({ pin: _p, ...w }: FieldWorker) => w;

@Injectable()
export class FieldViews {
  constructor(
    private customers: CustomerStore,
    private types: TaskTypeStore,
    private workers: FieldWorkerStore,
    private regions: RegionStore,
    private subs: SubscriptionStore,
  ) {}

  async names(userId: string): Promise<Names> {
    const [customers, types, workers, regions] = await Promise.all([
      this.customers.listByUser(userId),
      this.types.listByUser(userId),
      this.workers.listByUser(userId),
      this.regions.listByUser(userId),
    ]);
    const c = new Map(customers.map((x) => [x.id, x.name]));
    const t = new Map(types.map((x) => [x.id, x.name]));
    const w = new Map(workers.map((x) => [x.id, x.name]));
    const r = new Map(regions.map((x) => [x.id, x]));
    return {
      customer: (id) => c.get(id) ?? "—",
      type: (id) => t.get(id) ?? "—",
      worker: (id) => w.get(id) ?? "—",
      region: (id) => (id && r.get(id)) || null,
    };
  }

  subscription(s: Subscription, n: Names) {
    return {
      ...s,
      customerName: n.customer(s.customerId),
      region: n.region(s.regionId),
      schedule: { es: scheduleText(s, "es"), en: scheduleText(s, "en") },
      items: s.items.map((i) => ({ ...i, taskTypeName: n.type(i.taskTypeId) })),
    };
  }

  task(t: FieldTask, n: Names) {
    return { ...t, customerName: n.customer(t.customerId), taskTypeName: n.type(t.taskTypeId), workerName: n.worker(t.workerId), regionName: n.region(t.regionId)?.name ?? "—" };
  }

  workerTask(t: FieldTask, n: Names) {
    return { ...workerView(t), customerName: n.customer(t.customerId), taskTypeName: n.type(t.taskTypeId), workerName: n.worker(t.workerId) };
  }

  async regionsWithMembers(userId: string) {
    const [regions, subs, workers, n] = await Promise.all([this.regions.listByUser(userId), this.subs.listByUser(userId), this.workers.listByUser(userId), this.names(userId)]);
    const w = new Map(workers.map((x) => [x.id, x]));
    return regions.map((r) => ({
      ...r,
      worker: r.workerId && w.get(r.workerId) ? { id: r.workerId, name: w.get(r.workerId)!.name, role: w.get(r.workerId)!.role ?? "worker" } : null,
      subscriptions: subs.filter((s) => s.regionId === r.id && s.active).map((s) => this.subscription(s, n)),
    }));
  }
}
