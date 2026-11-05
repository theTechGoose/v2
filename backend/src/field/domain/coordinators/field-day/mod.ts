/** REQ-141 — the day's round: generated on demand, idempotent per day. */
import { Injectable } from "#danet/core";
import { FieldTaskStore, RegionStore, SubscriptionStore } from "@field/domain/data/field-stores/mod.ts";
import { generateTasks, unstaffed } from "@field/domain/business/tasks/mod.ts";
import type { FieldTask, Subscription } from "@field/dto/field.ts";
import { newId } from "@field/domain/coordinators/field-zones/mod.ts";

@Injectable()
export class FieldDay {
  constructor(private subs: SubscriptionStore, private regions: RegionStore, private tasks: FieldTaskStore) {}

  /** make the day's tasks that do not exist yet; answers them and the due subscriptions no worker covers */
  async generate(userId: string, date: string): Promise<{ created: FieldTask[]; skipped: Subscription[]; all: FieldTask[] }> {
    // REQ-163: a task the office deleted stays as a tombstone, so the round does not bring it back
    const [subscriptions, regions, existing] = await Promise.all([this.subs.listByUser(userId), this.regions.listByUser(userId), this.tasks.listByDay(userId, date, { withDeleted: true })]);
    const created = generateTasks({ userId, date, subscriptions, regions, existing, newId });
    await this.tasks.putMany(created);
    return { created, skipped: unstaffed({ date, subscriptions, regions }), all: [...existing.filter((t) => !t.deleted), ...created] };
  }

  /** REQ-141: open future work follows a change — drop not-yet-done tasks from `fromDate` on that match */
  async dropOpen(userId: string, fromDate: string, match: (t: FieldTask) => boolean): Promise<number> {
    const rows = await this.tasks.listByRange(userId, fromDate, "9999-12-31");
    const gone = rows.filter((t) => match(t) && t.status === "assigned" && !t.invoiceId);
    await this.tasks.deleteMany(gone);
    return gone.length;
  }
}
