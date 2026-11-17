/**
 * REQ-806 — the ops asks. Each is kept 30 days as the audit trail (who was asked for, why, when
 * approved or denied, when the view was taken).
 *
 *   ["ops-request", id]            → OpsRequest
 *   ["ops-approve", approveHash]   → id
 */
import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import type { OpsRequest } from "@users/domain/business/ops-access/mod.ts";

const KEEP_MS = 30 * 24 * 60 * 60_000;

@Injectable()
export class OpsRequestStore {
  async put(r: OpsRequest): Promise<void> {
    const kv = await getKv();
    await kv.atomic()
      .set(["ops-request", r.id], r, { expireIn: KEEP_MS })
      .set(["ops-approve", r.approveHash], r.id, { expireIn: KEEP_MS })
      .commit();
  }

  async get(id: string): Promise<OpsRequest | null> {
    const kv = await getKv();
    return (await kv.get<OpsRequest>(["ops-request", id])).value ?? null;
  }

  async byApproveHash(hash: string): Promise<OpsRequest | null> {
    const kv = await getKv();
    const id = (await kv.get<string>(["ops-approve", hash])).value;
    return id ? await this.get(id) : null;
  }

  /** write `next` only if the record is still what `prev` read (no double approve) */
  async swap(prev: OpsRequest, next: OpsRequest): Promise<boolean> {
    const kv = await getKv();
    const cur = await kv.get<OpsRequest>(["ops-request", prev.id]);
    if (!cur.value || JSON.stringify(cur.value) !== JSON.stringify(prev)) {
      return false;
    }
    const r = await kv.atomic().check(cur).set(["ops-request", next.id], next, {
      expireIn: KEEP_MS,
    }).commit();
    return r.ok;
  }
}
