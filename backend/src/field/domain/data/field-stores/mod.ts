/**
 * REQ-137 — the field module's own records, one store per entity, every one
 * owned by a user (the account). Storage, per entity `<p>`:
 *   [<p>, id]                 → the record (carries userId)
 *   [<p>_by_user, userId, id] → id        (listByUser, read in batches — REQ-134)
 * Tasks also index by day: [field_task_by_day, userId, date, id] → id —
 * REQ-785: one such key for EACH day a multi-day job covers.
 */
import { Injectable } from "#danet/core";
import { getKv, indexedIds, readMany } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import type { Batch, FieldTask, FieldWorker, Region, Subscription, TaskType } from "@field/dto/field.ts";
import { daysCovered, lastDayOf } from "@field/domain/business/job-span/mod.ts";

interface Owned {
  id: string;
  userId: string;
}

export class OwnedStore<T extends Owned> {
  constructor(protected prefix: string) {}
  protected get index() {
    return `${this.prefix}_by_user`;
  }
  protected extraKeys(_rec: T): Deno.KvKey[] {
    return [];
  }

  async put(rec: T): Promise<T> {
    const kv = await getKv();
    const op = kv.atomic().set([this.prefix, rec.id], rec).set([this.index, rec.userId, rec.id], rec.id);
    for (const k of this.extraKeys(rec)) op.set(k, rec.id);
    await op.commit();
    return rec;
  }

  /** many records in as few atomic commits as KV allows */
  async putMany(recs: T[]): Promise<void> {
    if (!recs.length) return;
    const kv = await getKv();
    for (let i = 0; i < recs.length; i += 100) {
      const op = kv.atomic();
      for (const rec of recs.slice(i, i + 100)) {
        op.set([this.prefix, rec.id], rec).set([this.index, rec.userId, rec.id], rec.id);
        for (const k of this.extraKeys(rec)) op.set(k, rec.id);
      }
      await op.commit();
    }
  }

  async get(id: string): Promise<T> {
    const kv = await getKv();
    const r = await kv.get<T>([this.prefix, id]);
    if (!r.value) throw new NotFoundError(this.prefix, id);
    return r.value;
  }

  async find(id: string): Promise<T | null> {
    const kv = await getKv();
    return (await kv.get<T>([this.prefix, id])).value;
  }

  async getOwned(id: string, userId: string): Promise<T> {
    const rec = await this.get(id);
    if (rec.userId !== userId) throw new ForbiddenError(this.prefix, id);
    return rec;
  }

  async listByUser(userId: string): Promise<T[]> {
    const kv = await getKv();
    const ids = await indexedIds(kv, [this.index, userId]);
    const recs = await readMany<T>(kv, ids.map((id) => [this.prefix, id]));
    return recs.filter((r): r is T => !!r);
  }

  async delete(rec: T): Promise<void> {
    const kv = await getKv();
    const op = kv.atomic().delete([this.prefix, rec.id]).delete([this.index, rec.userId, rec.id]);
    for (const k of this.extraKeys(rec)) op.delete(k);
    await op.commit();
  }

  async deleteMany(recs: T[]): Promise<void> {
    for (const r of recs) await this.delete(r);
  }
}

@Injectable()
export class FieldWorkerStore extends OwnedStore<FieldWorker> {
  constructor() {
    super("field_worker");
  }
  protected override extraKeys(w: FieldWorker): Deno.KvKey[] {
    return [["field_worker_by_phone", w.phoneNumber]];
  }
  /** REQ-138: the cell is the login name — unique across the app */
  async findByPhone(digits: string): Promise<FieldWorker | null> {
    const kv = await getKv();
    const id = (await kv.get<string>(["field_worker_by_phone", digits])).value;
    return id ? await this.find(id) : null;
  }
}

@Injectable()
export class TaskTypeStore extends OwnedStore<TaskType> {
  constructor() {
    super("field_task_type");
  }
}

@Injectable()
export class SubscriptionStore extends OwnedStore<Subscription> {
  constructor() {
    super("field_subscription");
  }
}

@Injectable()
export class RegionStore extends OwnedStore<Region> {
  constructor() {
    super("field_region");
  }
}

/** REQ-785: writes per atomic commit — KV refuses a commit of more than 1000 mutations */
const KV_MUTATIONS = 900;

@Injectable()
export class FieldTaskStore extends OwnedStore<FieldTask> {
  constructor() {
    super("field_task");
  }
  /** REQ-785: one day key per day the task covers — a multi-day job lists on each of its days */
  protected override extraKeys(t: FieldTask): Deno.KvKey[] {
    return daysCovered(t).map((d) => ["field_task_by_day", t.userId, d, t.id]);
  }

  override async put(rec: FieldTask): Promise<FieldTask> {
    await this.putMany([rec]);
    return rec;
  }

  /** REQ-785: a re-put whose days changed drops the day keys it left; commits stay under KV's mutation cap */
  override async putMany(recs: FieldTask[]): Promise<void> {
    if (!recs.length) return;
    const kv = await getKv();
    const before = await readMany<FieldTask>(kv, recs.map((r) => [this.prefix, r.id]));
    let op = kv.atomic(), n = 0;
    for (const [i, rec] of recs.entries()) {
      const keys = this.extraKeys(rec);
      const kept = new Set(keys.map((k) => k[2]));
      const prev = before[i];
      const left = prev ? this.extraKeys(prev).filter((k) => !kept.has(k[2])) : [];
      const writes = 2 + keys.length + left.length;
      if (n > 0 && n + writes > KV_MUTATIONS) {
        await op.commit();
        op = kv.atomic();
        n = 0;
      }
      op.set([this.prefix, rec.id], rec).set([this.index, rec.userId, rec.id], rec.id);
      for (const k of keys) op.set(k, rec.id);
      for (const k of left) op.delete(k);
      n += writes;
    }
    await op.commit();
  }

  /**
   * the account's tasks from one day to another, inclusive — a deleted one (REQ-163) only when asked.
   * REQ-785: a job of several days is keyed under each of its days: it comes back ONCE, when one of its days is in the range.
   */
  async listByRange(userId: string, from: string, to: string, opts: { withDeleted?: boolean } = {}): Promise<FieldTask[]> {
    const kv = await getKv();
    const ids = new Set<string>();
    for await (const e of kv.list<string>({ start: ["field_task_by_day", userId, from], end: ["field_task_by_day", userId, to + "\u0000"] })) ids.add(e.value);
    const recs = await readMany<FieldTask>(kv, [...ids].map((id) => ["field_task", id]));
    return recs.filter((t): t is FieldTask => !!t && t.date <= to && lastDayOf(t) >= from && (opts.withDeleted || !t.deleted));
  }
  listByDay(userId: string, date: string, opts: { withDeleted?: boolean } = {}): Promise<FieldTask[]> {
    return this.listByRange(userId, date, date, opts);
  }
}

@Injectable()
export class BatchStore extends OwnedStore<Batch> {
  constructor() {
    super("field_batch");
  }
}
