/** The names the pages show next to ids — customers (CustomerStore), types, workers, zones. */
import { Injectable } from "#danet/core";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChecklistStore, CrewStore, FieldWorkerStore, RegionStore, SubscriptionStore, TaskTypeStore } from "@field/domain/data/field-stores/mod.ts";
import { crewMembers } from "@field/domain/business/crews/mod.ts"; // REQ-840
import { scheduleText } from "@field/domain/business/schedule/mod.ts";
import { subscriptionBilling } from "@field/domain/business/quote-subscription/mod.ts"; // REQ-699
import { workerView } from "@field/domain/business/tasks/mod.ts";
import { checklistUsage, withChecklist } from "@field/domain/business/checklist/mod.ts"; // REQ-811
import type { Absence, Checklist, Crew, FieldTask, FieldWorker, Region, Subscription } from "@field/dto/field.ts";

export interface Names {
  customer: (id: string) => string;
  type: (id: string) => string;
  worker: (id: string) => string;
  region: (id: string | undefined) => Region | null;
  /** REQ-811: the checklist a repeat visit references */
  checklist: (id: string | undefined) => Checklist | null;
  /** REQ-840: a crew */
  crew: (id: string | undefined) => Crew | null;
  /** REQ-401: the status of a task's invoice — only the worker views load it */
  invoiceStatus?: (id: string | undefined) => string | undefined;
}

export const safeWorker = ({ pin: _p, ...w }: FieldWorker) => w;

/** REQ-785: the names of a job's other workers, in crewIds' order */
const crewNames = (t: FieldTask, n: Names) => (t.crewIds?.length ? { crewNames: t.crewIds.map((id) => n.worker(id)) } : {});
/** REQ-1162 (q3-94): a task whose worker record is gone (or that has none) is `unassigned` — never Worker "—" beside ASSIGNED */
const orphaned = (t: FieldTask, n: Names) => (n.worker(t.workerId) === "—" ? { unassigned: true as const } : {});
/** REQ-841/842: the crew doing the task, and who it covers for (a crew or a worker) */
const crewLine = (t: FieldTask, n: Names) => ({
  ...(t.crewId && n.crew(t.crewId) ? { crewName: n.crew(t.crewId)!.name } : {}),
  ...(t.coverFor ? { coverForName: n.crew(t.coverFor)?.name ?? n.worker(t.coverFor) } : {}),
});

@Injectable()
export class FieldViews {
  constructor(
    private customers: CustomerStore,
    private types: TaskTypeStore,
    private workers: FieldWorkerStore,
    private regions: RegionStore,
    private subs: SubscriptionStore,
    private invoices: InvoiceStore,
    private checklists: ChecklistStore,
    private crews: CrewStore, // REQ-840
  ) {}

  /** REQ-401: names + each invoice's status, so a worker's lock reads "draft" until it is sent */
  async workerNames(userId: string): Promise<Names> {
    const [n, invoices] = await Promise.all([this.names(userId), this.invoices.listByUser(userId)]);
    const status = new Map(invoices.map((i) => [i.id, i.status as string]));
    return { ...n, invoiceStatus: (id) => (id ? status.get(id) : undefined) };
  }

  async names(userId: string): Promise<Names> {
    const [customers, types, workers, regions, checklists, crews] = await Promise.all([
      this.customers.listByUser(userId),
      this.types.listByUser(userId),
      this.workers.listByUser(userId),
      this.regions.listByUser(userId),
      this.checklists.listByUser(userId),
      this.crews.listByUser(userId),
    ]);
    const k = new Map(checklists.map((x) => [x.id, x]));
    const cr = new Map(crews.map((x) => [x.id, x]));
    const c = new Map(customers.map((x) => [x.id, x.name]));
    const t = new Map(types.map((x) => [x.id, x.name]));
    const w = new Map(workers.map((x) => [x.id, x.name]));
    const r = new Map(regions.map((x) => [x.id, x]));
    return {
      customer: (id) => c.get(id) ?? "—",
      type: (id) => t.get(id) ?? "—",
      worker: (id) => w.get(id) ?? "—",
      region: (id) => (id && r.get(id)) || null,
      checklist: (id) => (id && k.get(id)) || null,
      crew: (id) => (id && cr.get(id)) || null,
    };
  }

  /** REQ-840: a crew with its members, foreman and services named, and how many zones list it */
  crew(c: Crew, workers: FieldWorker[], regions: Region[], n: Names) {
    const members = crewMembers(c, workers).map((w) => ({ id: w.id, name: w.name }));
    return {
      ...c,
      members,
      ...(c.foremanId ? { foremanName: n.worker(c.foremanId) } : {}),
      taskTypeNames: c.taskTypeIds.map((id) => n.type(id)),
      zones: regions.filter((r) => r.crewIds?.includes(c.id)).length,
    };
  }

  /** REQ-840: a worker row with the crew's name */
  worker(w: FieldWorker, n: Names) {
    const crew = n.crew(w.crewId);
    return { ...safeWorker(w), ...(crew ? { crewName: crew.name } : {}) };
  }

  /** REQ-842: an absence with who is out and who covers, named */
  absence(a: Absence, n: Names) {
    const who = a.crewId ? n.crew(a.crewId)?.name ?? "—" : n.worker(a.workerId ?? "");
    const cover = a.coverCrewId ? n.crew(a.coverCrewId)?.name ?? "—" : a.coverWorkerId ? n.worker(a.coverWorkerId) : undefined;
    return { ...a, name: who, ...(cover ? { coverName: cover } : {}) };
  }

  /** REQ-811: `items` is the EFFECTIVE list — the checklist's rows (flagged `fromChecklist`) then the visit's own */
  subscription(s: Subscription, n: Names) {
    const ckl = n.checklist(s.checklistId);
    const eff = withChecklist(s, () => ckl);
    const own = new Set(s.items.map((i) => i.taskTypeId));
    const billing = subscriptionBilling(eff); // REQ-699: a quote's "Monthly · $180/mo"
    return {
      ...s,
      customerName: n.customer(s.customerId),
      region: n.region(s.regionId),
      schedule: { es: scheduleText(s, "es"), en: scheduleText(s, "en") },
      ...(billing ? { billing } : {}),
      ...(ckl ? { checklistName: ckl.name } : {}),
      items: eff.items.map((i) => ({ ...i, taskTypeName: n.type(i.taskTypeId), ...(own.has(i.taskTypeId) ? {} : { fromChecklist: true as const }) })),
    };
  }

  /** REQ-811: a checklist with its services named and how many repeat visits reference it */
  checklist(c: Checklist, n: Names, subs: Pick<Subscription, "checklistId">[]) {
    return { ...c, items: c.items.map((i) => ({ ...i, taskTypeName: n.type(i.taskTypeId) })), usedBy: checklistUsage(subs, c.id) };
  }

  task(t: FieldTask, n: Names) {
    return { ...t, customerName: n.customer(t.customerId), taskTypeName: n.type(t.taskTypeId), workerName: n.worker(t.workerId), ...orphaned(t, n), regionName: n.region(t.regionId)?.name ?? "", ...crewNames(t, n), ...crewLine(t, n) }; // REQ-365: no zone (a one-off) is "", not "—"
  }

  workerTask(t: FieldTask, n: Names) {
    return { ...workerView(t, n.invoiceStatus?.(t.invoiceId)), customerName: n.customer(t.customerId), taskTypeName: n.type(t.taskTypeId), workerName: n.worker(t.workerId), ...crewNames(t, n), ...crewLine(t, n) };
  }

  async regionsWithMembers(userId: string) {
    const [regions, subs, workers, n] = await Promise.all([this.regions.listByUser(userId), this.subs.listByUser(userId), this.workers.listByUser(userId), this.names(userId)]);
    const w = new Map(workers.map((x) => [x.id, x]));
    return regions.map((r) => ({
      ...r,
      worker: r.workerId && w.get(r.workerId) ? { id: r.workerId, name: w.get(r.workerId)!.name, role: w.get(r.workerId)!.role ?? "worker" } : null,
      // REQ-841: the crews staffing the zone, in order
      crews: (r.crewIds ?? []).map((id) => n.crew(id)).filter((c): c is Crew => !!c).map((c) => ({ id: c.id, name: c.name, color: c.color })),
      subscriptions: subs.filter((s) => s.regionId === r.id && s.active).map((s) => this.subscription(s, n)),
    }));
  }
}
