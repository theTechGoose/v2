/**
 * REQ-072 — the CRM lead-capture outbox in KV: ["crm-capture", phone] → PendingCapture. A record
 * is written before the login replies and deleted only when the CRM has answered; everything in
 * between (claims, deferrals) is a compare-and-swap on the record's versionstamp so two sweeps
 * never work one record at once. REQ-098 — the account's customer sync rides the same outbox:
 * ["crm-capture", "user", userId] → PendingCapture with the userId, carried by ensure. REQ-099 — a save
 * made while that sync is in flight re-marks the record (a new enqueuedAt); the running sweep's
 * done() then leaves it, lease cleared, for the sweep that follows, so the CRM ends up with the
 * profile as last saved. REQ-103 — the sign-up's email to hello@documonster.com rides it too:
 * ["crm-capture", "signup-notice", userId] → PendingCapture with kind "signup-notice", carried by
 * SignupNotice.send.
 */
import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { backoffMs, LEASE_MS, type PendingCapture } from "@users/domain/business/lead-capture-retry/mod.ts";

const PREFIX = "crm-capture";

/** the record's key: a lead by its phone, a customer sync (REQ-098) by its account, a signup notice
 *  (REQ-103) by its account, apart from the sync */
const keyOf = (rec: Pick<PendingCapture, "phone" | "userId" | "kind">): Deno.KvKey =>
  rec.kind === "signup-notice"
    ? [PREFIX, "signup-notice", rec.userId ?? ""]
    : rec.kind === "pay-link"
    ? [PREFIX, "pay-link", rec.userId ?? ""] // REQ-106
    : rec.userId
    ? [PREFIX, "user", rec.userId]
    : [PREFIX, rec.phone];

@Injectable()
export class CrmCaptureOutbox {
  /** the KV the records live in — the process's; a test hands a sweep a KV of its own */
  protected kv(): Promise<Deno.Kv> {
    return getKv();
  }

  /** a record for the phone; an existing one is kept as it is (its attempts, its clock) */
  async add(phone: string, now: number): Promise<void> {
    const kv = await this.kv();
    const key = [PREFIX, phone];
    const existing = await kv.get<PendingCapture>(key);
    if (existing.value) return;
    const rec: PendingCapture = { phone, enqueuedAt: new Date(now).toISOString(), attempts: 0, nextAt: new Date(now).toISOString() };
    await kv.atomic().check(existing).set(key, rec).commit();
  }

  /** REQ-098 — a customer sync record for the account. REQ-099 — an existing one is re-marked
   *  (a new enqueuedAt, due now, its lease kept): the profile changed again, so the sweep that
   *  holds it must not clear it, and the next sweep carries the newer profile */
  async addSync(userId: string, now: number): Promise<void> {
    const kv = await this.kv();
    const key = keyOf({ phone: "", userId });
    const existing = await kv.get<PendingCapture>(key);
    const at = new Date(now).toISOString();
    const rec: PendingCapture = existing.value
      ? { ...existing.value, enqueuedAt: at, nextAt: at }
      : { phone: "", userId, enqueuedAt: at, attempts: 0, nextAt: at };
    await kv.atomic().check(existing).set(key, rec).commit();
  }

  /** REQ-103 — the new account's signup notice, a record of its own. REQ-112 — it says what
   *  happened; a later happening re-marks the record with the newer reason (a new enqueuedAt, due
   *  now, its lease kept), so a sweep holding the older one leaves it for the sweep that follows and
   *  the mail that goes out carries the latest */
  async addSignupNotice(userId: string, reason: string, now: number): Promise<void> {
    const kv = await this.kv();
    const key = keyOf({ phone: "", userId, kind: "signup-notice" });
    const existing = await kv.get<PendingCapture>(key);
    const at = new Date(now).toISOString();
    const rec: PendingCapture = {
      phone: "",
      userId,
      kind: "signup-notice",
      reason,
      enqueuedAt: at,
      attempts: 0,
      nextAt: at,
      ...(existing.value?.leaseUntil ? { leaseUntil: existing.value.leaseUntil } : {}),
    };
    await kv.atomic().check(existing).set(key, rec).commit();
  }

  /** REQ-106 — the account's pay link, a record of its own, keyed apart from the sync. A newer
   *  pick re-marks it (a new enqueuedAt, due now, its clock restarted); a lease a sweep holds is
   *  kept, so the running sweep leaves the re-marked record for the sweep that follows (REQ-099's
   *  rule) and no second sweep mints the stale pick meanwhile */
  async addPayLink(userId: string, back: string, now: number): Promise<void> {
    const kv = await this.kv();
    const key = keyOf({ phone: "", userId, kind: "pay-link" });
    const existing = await kv.get<PendingCapture>(key);
    const at = new Date(now).toISOString();
    const rec: PendingCapture = {
      phone: "",
      userId,
      kind: "pay-link",
      back,
      enqueuedAt: at,
      attempts: 0,
      nextAt: at,
      ...(existing.value?.leaseUntil ? { leaseUntil: existing.value.leaseUntil } : {}),
    };
    await kv.atomic().check(existing).set(key, rec).commit();
  }

  async list(): Promise<PendingCapture[]> {
    const kv = await this.kv();
    const out: PendingCapture[] = [];
    for await (const e of kv.list<PendingCapture>({ prefix: [PREFIX] })) out.push(e.value);
    return out;
  }

  /** take the record for one attempt: false when it changed or vanished under us */
  async claim(rec: PendingCapture, now: number): Promise<boolean> {
    const kv = await this.kv();
    const key = keyOf(rec);
    const current = await kv.get<PendingCapture>(key);
    if (!current.value) return false;
    if (current.value.leaseUntil && Date.parse(current.value.leaseUntil) > now) return false;
    const res = await kv.atomic().check(current).set(key, { ...current.value, leaseUntil: new Date(now + LEASE_MS).toISOString() }).commit();
    return res.ok;
  }

  /** the attempt failed: count it, note why, and set the next time */
  async defer(rec: PendingCapture, now: number, error: string): Promise<PendingCapture> {
    const kv = await this.kv();
    const key = keyOf(rec);
    const current = await kv.get<PendingCapture>(key);
    const base = current.value ?? rec;
    const attempts = base.attempts + 1;
    const next: PendingCapture = { phone: base.phone, ...(base.userId ? { userId: base.userId } : {}), ...(base.kind ? { kind: base.kind } : {}), ...(base.back ? { back: base.back } : {}), ...(base.reason ? { reason: base.reason } : {}), enqueuedAt: base.enqueuedAt, attempts, nextAt: new Date(now + backoffMs(attempts)).toISOString(), lastError: error.slice(0, 300) };
    await kv.set(key, next);
    return next;
  }

  /** the CRM answered for the record as the sweep claimed it: gone — unless it was re-marked
   *  meanwhile (REQ-099), in which case it stays, lease cleared, for the sweep that follows */
  async done(rec: Pick<PendingCapture, "phone" | "userId" | "kind" | "enqueuedAt">): Promise<void> {
    const kv = await this.kv();
    const key = keyOf(rec);
    const current = await kv.get<PendingCapture>(key);
    if (!current.value) return;
    if (current.value.enqueuedAt === rec.enqueuedAt) {
      await kv.atomic().check(current).delete(key).commit();
      return;
    }
    const { leaseUntil: _lease, ...again } = current.value;
    await kv.atomic().check(current).set(key, again).commit();
  }
}
