/**
 * REQ-072 — the CRM lead-capture outbox in KV: ["crm-capture", phone] → PendingCapture. A record
 * is written before the login replies and deleted only when the CRM has answered; everything in
 * between (claims, deferrals) is a compare-and-swap on the record's versionstamp so two sweeps
 * never work one record at once.
 */
import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { backoffMs, LEASE_MS, type PendingCapture } from "@users/domain/business/lead-capture-retry/mod.ts";

const PREFIX = "crm-capture";

@Injectable()
export class CrmCaptureOutbox {
  /** a record for the phone; an existing one is kept as it is (its attempts, its clock) */
  async add(phone: string, now: number): Promise<void> {
    const kv = await getKv();
    const key = [PREFIX, phone];
    const existing = await kv.get<PendingCapture>(key);
    if (existing.value) return;
    const rec: PendingCapture = { phone, enqueuedAt: new Date(now).toISOString(), attempts: 0, nextAt: new Date(now).toISOString() };
    await kv.atomic().check(existing).set(key, rec).commit();
  }

  async list(): Promise<PendingCapture[]> {
    const kv = await getKv();
    const out: PendingCapture[] = [];
    for await (const e of kv.list<PendingCapture>({ prefix: [PREFIX] })) out.push(e.value);
    return out;
  }

  /** take the record for one attempt: false when it changed or vanished under us */
  async claim(rec: PendingCapture, now: number): Promise<boolean> {
    const kv = await getKv();
    const key = [PREFIX, rec.phone];
    const current = await kv.get<PendingCapture>(key);
    if (!current.value) return false;
    if (current.value.leaseUntil && Date.parse(current.value.leaseUntil) > now) return false;
    const res = await kv.atomic().check(current).set(key, { ...current.value, leaseUntil: new Date(now + LEASE_MS).toISOString() }).commit();
    return res.ok;
  }

  /** the attempt failed: count it, note why, and set the next time */
  async defer(rec: PendingCapture, now: number, error: string): Promise<PendingCapture> {
    const kv = await getKv();
    const key = [PREFIX, rec.phone];
    const current = await kv.get<PendingCapture>(key);
    const base = current.value ?? rec;
    const attempts = base.attempts + 1;
    const next: PendingCapture = { phone: base.phone, enqueuedAt: base.enqueuedAt, attempts, nextAt: new Date(now + backoffMs(attempts)).toISOString(), lastError: error.slice(0, 300) };
    await kv.set(key, next);
    return next;
  }

  async done(phone: string): Promise<void> {
    const kv = await getKv();
    await kv.delete([PREFIX, phone]);
  }
}
