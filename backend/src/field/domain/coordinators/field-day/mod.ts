/** REQ-141 — the day's round: generated on demand, idempotent per day. */
import { Injectable } from "#danet/core";
import { AbsenceStore, ChecklistStore, CrewStore, FieldTaskStore, FieldWorkerStore, RegionStore, SubscriptionStore } from "@field/domain/data/field-stores/mod.ts";
import { generateTasks, type RoundStaff, uncovered, unstaffed } from "@field/domain/business/tasks/mod.ts";
import { withChecklist } from "@field/domain/business/checklist/mod.ts"; // REQ-811
import type { FieldTask, Subscription } from "@field/dto/field.ts";
import { newId } from "@field/domain/coordinators/field-zones/mod.ts";

/** a UUID-shaped id derived from what makes a generated task unique: the account, its subscription, the service, the day */
export async function stableTaskId(t: Pick<FieldTask, "userId" | "subscriptionId" | "taskTypeId" | "date">): Promise<string> {
  const bytes = new TextEncoder().encode(`field-task|${t.userId}|${t.subscriptionId}|${t.taskTypeId}|${t.date}`);
  const hex = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

@Injectable()
export class FieldDay {
  constructor(
    private subs: SubscriptionStore,
    private regions: RegionStore,
    private tasks: FieldTaskStore,
    private checklists: ChecklistStore,
    private crews: CrewStore, // REQ-841
    private workers: FieldWorkerStore,
    private absences: AbsenceStore, // REQ-842
  ) {}

  /** REQ-841/842: who can work — the crews, the workers, who is out */
  async staff(userId: string): Promise<Required<RoundStaff>> {
    const [crews, workers, absences] = await Promise.all([this.crews.listByUser(userId), this.workers.listByUser(userId), this.absences.listByUser(userId)]);
    return { crews, workers, absences };
  }

  /** REQ-811: the account's repeat visits with their EFFECTIVE services (the checklist's + their own) */
  async effectiveSubscriptions(userId: string): Promise<Subscription[]> {
    const [subs, checklists] = await Promise.all([this.subs.listByUser(userId), this.checklists.listByUser(userId)]);
    const byId = new Map(checklists.map((c) => [c.id, c]));
    return subs.map((s) => withChecklist(s, (id) => byId.get(id)));
  }

  /** REQ-811: one repeat visit with its effective services */
  async effective(s: Subscription): Promise<Subscription> {
    if (!s.checklistId) return s;
    const c = await this.checklists.find(s.checklistId);
    return withChecklist(s, () => (c && c.userId === s.userId ? c : null));
  }

  /** make the day's tasks that do not exist yet; answers them and the due subscriptions no worker covers */
  async generate(userId: string, date: string): Promise<{ created: FieldTask[]; skipped: Subscription[]; all: FieldTask[] }> {
    // REQ-163: a task the office deleted stays as a tombstone, so the round does not bring it back
    const [subscriptions, regions, existing, staff] = await Promise.all([
      this.effectiveSubscriptions(userId),
      this.regions.listByUser(userId),
      this.tasks.listByDay(userId, date, { withDeleted: true }),
      this.staff(userId),
    ]);
    const made = generateTasks({ userId, date, subscriptions, regions, existing, newId, ...staff });
    // REQ-170: a generated task's id is a function of (account, subscription, type, day), so two reads of the
    // same day at the same instant (the office and a worker, the page's two requests) write the SAME record
    for (const t of made) t.id = await stableTaskId(t);
    const created = made.filter((t) => t.date === date);
    // REQ-842: a deferred visit's copy sits on a later day — it never overwrites a record already there
    // (that day's own visit, if any, absorbs the work — the worker-defer rule)
    let copies = made.filter((t) => t.date !== date);
    if (copies.length) {
      const days = [...new Set(copies.map((t) => t.date))];
      const there = new Set((await Promise.all(days.map((d) => this.tasks.listByDay(userId, d, { withDeleted: true })))).flat().map((t) => t.id));
      copies = copies.filter((t) => !there.has(t.id));
    }
    await this.tasks.putMany([...created, ...copies]);
    return { created, skipped: unstaffed({ date, subscriptions, regions, ...staff }), all: [...existing.filter((t) => !t.deleted), ...created] };
  }

  /** REQ-170/841: the visits due that day with a service nobody covers, and which services — read-only, nothing is generated */
  async uncoveredOn(userId: string, date: string): Promise<{ subscription: Subscription; taskTypeIds: string[] }[]> {
    const [subscriptions, regions, staff] = await Promise.all([this.effectiveSubscriptions(userId), this.regions.listByUser(userId), this.staff(userId)]);
    return uncovered({ date, subscriptions, regions, ...staff });
  }

  /** REQ-170: the subscriptions due that day with a service nobody covers — read-only, nothing is generated */
  async unstaffedOn(userId: string, date: string): Promise<Subscription[]> {
    return (await this.uncoveredOn(userId, date)).map((u) => u.subscription);
  }

  /**
   * REQ-141: open future work follows a change — drop not-yet-done tasks from `fromDate` (to `toDate`) that
   * match, so the next read re-derives them. REQ-842: what an absence decided (`byAbsence`) is dropped too,
   * whatever its status — a one-off, a done or an invoiced task never is.
   */
  async dropOpen(userId: string, fromDate: string, match: (t: FieldTask) => boolean, toDate = "9999-12-31"): Promise<number> {
    const rows = await this.tasks.listByRange(userId, fromDate, toDate);
    const gone = rows.filter((t) => match(t) && !t.oneOff && !t.invoiceId && (t.status === "assigned" || (!!t.byAbsence && t.status !== "complete")));
    await this.tasks.deleteMany(gone);
    return gone.length;
  }
}
