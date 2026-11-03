/**
 * REQ-137 — the field module's own records, one store per entity, every one
 * owned by a user (the account). Storage, per entity `<p>`:
 *   [<p>, id]                 → the record (carries userId)
 *   [<p>_by_user, userId, id] → id        (listByUser, read in batches — REQ-134)
 * Tasks also index by day: [field_task_by_day, userId, date, id] → id.
 */
import { Injectable } from "#danet/core";
import { getKv, indexedIds, readMany } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import type { Batch, FieldTask, FieldWorker, Region, Subscription, TaskType } from "@field/dto/field.ts";

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

@Injectable()
export class FieldTaskStore extends OwnedStore<FieldTask> {
  constructor() {
    super("field_task");
  }
  protected override extraKeys(t: FieldTask): Deno.KvKey[] {
    return [["field_task_by_day", t.userId, t.date, t.id]];
  }
  /** the account's tasks from one day to another, inclusive */
  async listByRange(userId: string, from: string, to: string): Promise<FieldTask[]> {
    const kv = await getKv();
    const ids: string[] = [];
    for await (const e of kv.list<string>({ start: ["field_task_by_day", userId, from], end: ["field_task_by_day", userId, to + "\u0000"] })) ids.push(e.value);
    const recs = await readMany<FieldTask>(kv, ids.map((id) => ["field_task", id]));
    return recs.filter((t): t is FieldTask => !!t);
  }
  listByDay(userId: string, date: string): Promise<FieldTask[]> {
    return this.listByRange(userId, date, date);
  }
}

@Injectable()
export class BatchStore extends OwnedStore<Batch> {
  constructor() {
    super("field_batch");
  }
}
