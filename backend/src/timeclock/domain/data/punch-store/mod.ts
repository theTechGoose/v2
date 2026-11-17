/**
 * REQ-192 — the punches, in KV, every one owned by an account:
 *   [timeclock_punch, id]                              → the record
 *   [timeclock_punch_by_user, userId, id]              → id   (the account's log)
 *   [timeclock_punch_by_worker, userId, workerId, at, id] → id (a worker's, in time order)
 *   [timeclock_last, userId, workerId]                 → the worker's latest non-voided punch
 * The `last` marker is what a worker's punch checks-and-sets atomically: two taps at the same
 * instant cannot both see "out" and both record an "in" (one commit fails and is refused).
 */
import { Injectable } from "#danet/core";
import { getKv, readMany } from "@core/data/kv/mod.ts";
import { OwnedStore } from "@field/domain/data/field-stores/mod.ts";
import type { Punch, PunchType } from "@timeclock/dto/timeclock.ts";
import type { PunchLike } from "@timeclock/domain/business/shifts/mod.ts";

const byAt = (a: Punch, b: Punch) =>
  a.at < b.at
    ? -1
    : a.at > b.at
    ? 1
    : a.createdAt < b.createdAt
    ? -1
    : a.createdAt > b.createdAt
    ? 1
    : 0;

@Injectable()
export class PunchStore extends OwnedStore<Punch> {
  constructor() {
    super("timeclock_punch");
  }
  protected override extraKeys(p: Punch): Deno.KvKey[] {
    return [["timeclock_punch_by_worker", p.userId, p.workerId, p.at, p.id]];
  }

  /** a worker's punches, oldest first, voided ones included unless `activeOnly` */
  async listByWorker(
    userId: string,
    workerId: string,
    activeOnly = true,
  ): Promise<Punch[]> {
    const kv = await getKv();
    const ids: string[] = [];
    for await (
      const e of kv.list<string>({
        prefix: ["timeclock_punch_by_worker", userId, workerId],
      })
    ) ids.push(e.value);
    const recs =
      (await readMany<Punch>(kv, ids.map((id) => ["timeclock_punch", id])))
        .filter((p): p is Punch => !!p);
    return recs.filter((p) => !activeOnly || !p.voided).sort(byAt);
  }

  /** the account's punches in a window, oldest first, voided included */
  async listByUserRange(
    userId: string,
    from: string,
    to: string,
    workerId?: string,
  ): Promise<Punch[]> {
    const all = workerId
      ? await this.listByWorker(userId, workerId, false)
      : await this.listByUser(userId);
    return all.filter((p) => p.at >= from && p.at < to).sort(byAt);
  }

  async last(
    userId: string,
    workerId: string,
  ): Promise<Deno.KvEntryMaybe<PunchLike>> {
    const kv = await getKv();
    return await kv.get<PunchLike>(["timeclock_last", userId, workerId]);
  }

  /**
   * append a worker's punch only if the worker's last punch is still the one the caller saw —
   * false when another tap got there first
   */
  async appendIfLast(
    p: Punch,
    seen: Deno.KvEntryMaybe<PunchLike>,
  ): Promise<boolean> {
    const kv = await getKv();
    const r = await kv.atomic()
      .check(seen)
      .set(["timeclock_punch", p.id], p)
      .set([this.index, p.userId, p.id], p.id)
      .set(
        ["timeclock_punch_by_worker", p.userId, p.workerId, p.at, p.id],
        p.id,
      )
      .set(
        ["timeclock_last", p.userId, p.workerId],
        { id: p.id, type: p.type, at: p.at } satisfies PunchLike,
      )
      .commit();
    return r.ok;
  }

  /** after a manual punch or a void: the marker follows the worker's latest non-voided punch */
  async recomputeLast(userId: string, workerId: string): Promise<void> {
    const kv = await getKv();
    const active = await this.listByWorker(userId, workerId, true);
    const last = active.at(-1);
    const key: Deno.KvKey = ["timeclock_last", userId, workerId];
    if (last) {
      await kv.set(
        key,
        { id: last.id, type: last.type, at: last.at } satisfies PunchLike,
      );
    } else await kv.delete(key);
  }
}

export const punchType = (v: unknown): PunchType | null =>
  v === "in" || v === "out" ? v : null;
