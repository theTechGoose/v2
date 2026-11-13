/** The names the pages show next to ids — customers (CustomerStore), types, workers, zones. */
import { Injectable } from "#danet/core";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { FieldWorkerStore, RegionStore, SubscriptionStore, TaskTypeStore } from "@field/domain/data/field-stores/mod.ts";
import { scheduleText } from "@field/domain/business/schedule/mod.ts";
import { subscriptionBilling } from "@field/domain/business/quote-subscription/mod.ts"; // REQ-699
import { workerView } from "@field/domain/business/tasks/mod.ts";
import type { FieldTask, FieldWorker, Region, Subscription } from "@field/dto/field.ts";

export interface Names {
  customer: (id: string) => string;
  type: (id: string) => string;
  worker: (id: string) => string;
  region: (id: string | undefined) => Region | null;
  /** REQ-401: the status of a task's invoice — only the worker views load it */
  invoiceStatus?: (id: string | undefined) => string | undefined;
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
    private invoices: InvoiceStore,
  ) {}

  /** REQ-401: names + each invoice's status, so a worker's lock reads "draft" until it is sent */
  async workerNames(userId: string): Promise<Names> {
    const [n, invoices] = await Promise.all([this.names(userId), this.invoices.listByUser(userId)]);
    const status = new Map(invoices.map((i) => [i.id, i.status as string]));
    return { ...n, invoiceStatus: (id) => (id ? status.get(id) : undefined) };
  }

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
    const billing = subscriptionBilling(s); // REQ-699: a quote's "Monthly · $180/mo"
    return {
      ...s,
      customerName: n.customer(s.customerId),
      region: n.region(s.regionId),
      schedule: { es: scheduleText(s, "es"), en: scheduleText(s, "en") },
      ...(billing ? { billing } : {}),
      items: s.items.map((i) => ({ ...i, taskTypeName: n.type(i.taskTypeId) })),
    };
  }

  task(t: FieldTask, n: Names) {
    return { ...t, customerName: n.customer(t.customerId), taskTypeName: n.type(t.taskTypeId), workerName: n.worker(t.workerId), regionName: n.region(t.regionId)?.name ?? "" }; // REQ-365: no zone (a one-off) is "", not "—"
  }

  workerTask(t: FieldTask, n: Names) {
    return { ...workerView(t, n.invoiceStatus?.(t.invoiceId)), customerName: n.customer(t.customerId), taskTypeName: n.type(t.taskTypeId), workerName: n.worker(t.workerId) };
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
