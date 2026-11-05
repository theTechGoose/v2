/** REQ-141 — the day's round: generated on demand, idempotent per day. */
import { Injectable } from "#danet/core";
import { FieldTaskStore, RegionStore, SubscriptionStore } from "@field/domain/data/field-stores/mod.ts";
import { generateTasks, unstaffed } from "@field/domain/business/tasks/mod.ts";
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
  constructor(private subs: SubscriptionStore, private regions: RegionStore, private tasks: FieldTaskStore) {}

  /** make the day's tasks that do not exist yet; answers them and the due subscriptions no worker covers */
  async generate(userId: string, date: string): Promise<{ created: FieldTask[]; skipped: Subscription[]; all: FieldTask[] }> {
    // REQ-163: a task the office deleted stays as a tombstone, so the round does not bring it back
    const [subscriptions, regions, existing] = await Promise.all([this.subs.listByUser(userId), this.regions.listByUser(userId), this.tasks.listByDay(userId, date, { withDeleted: true })]);
    const created = generateTasks({ userId, date, subscriptions, regions, existing, newId });
    // REQ-170: a generated task's id is a function of (account, subscription, type, day), so two reads of the
    // same day at the same instant (the office and a worker, the page's two requests) write the SAME record
    for (const t of created) t.id = await stableTaskId(t);
    await this.tasks.putMany(created);
    return { created, skipped: unstaffed({ date, subscriptions, regions }), all: [...existing.filter((t) => !t.deleted), ...created] };
  }

  /** REQ-170: the subscriptions due that day whose zone has no worker — read-only, nothing is generated */
  async unstaffedOn(userId: string, date: string): Promise<Subscription[]> {
    const [subscriptions, regions] = await Promise.all([this.subs.listByUser(userId), this.regions.listByUser(userId)]);
    return unstaffed({ date, subscriptions, regions });
  }

  /** REQ-141: open future work follows a change — drop not-yet-done tasks from `fromDate` on that match */
  async dropOpen(userId: string, fromDate: string, match: (t: FieldTask) => boolean): Promise<number> {
    const rows = await this.tasks.listByRange(userId, fromDate, "9999-12-31");
    const gone = rows.filter((t) => match(t) && t.status === "assigned" && !t.invoiceId);
    await this.tasks.deleteMany(gone);
    return gone.length;
  }
}
