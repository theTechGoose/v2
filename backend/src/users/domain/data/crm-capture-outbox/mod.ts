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

/** how many times a settling write re-reads a record whose version moved under it (REQ-113): a
 *  wizard's saves re-mark a record a handful of times in a row, never more */
const SETTLE_ATTEMPTS = 8;
import { backoffMs, LEASE_MS, type PendingCapture, WATCH_FOR_MS } from "@users/domain/business/lead-capture-retry/mod.ts";
import type { LeadOrigin } from "#lead-origin/mod.ts";
import type { UserPlan } from "@users/dto/plan.ts";

const PREFIX = "crm-capture";
/** REQ-133 — ["crm-capture-due", dueId] → userId: the account whose watch names the due, for the CRM's settled notice */
const DUE_INDEX = "crm-capture-due";

/** the record's key: a lead by its phone, a customer sync (REQ-098) by its account, a signup notice
 *  (REQ-103) by its account, apart from the sync */
const keyOf = (rec: Pick<PendingCapture, "phone" | "userId" | "kind">): Deno.KvKey =>
  rec.kind === "signup-notice"
    ? [PREFIX, "signup-notice", rec.userId ?? ""]
    : rec.kind === "pay-link"
    ? [PREFIX, "pay-link", rec.userId ?? ""] // REQ-106
    : rec.kind === "settle-watch"
    ? [PREFIX, "settle-watch", rec.userId ?? ""] // REQ-131
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
  async add(phone: string, now: number, origin?: LeadOrigin): Promise<void> {
    const kv = await this.kv();
    const key = [PREFIX, phone];
    const existing = await kv.get<PendingCapture>(key);
    if (existing.value) return;
    const rec: PendingCapture = { phone, ...(origin ? { origin } : {}), enqueuedAt: new Date(now).toISOString(), attempts: 0, nextAt: new Date(now).toISOString() };
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

  /** REQ-131 — the watch on a minted due: the pick the page was made for and a 48 h window. Re-marked
   *  (a new enqueuedAt, due now, its clock restarted, the window from now) when the person comes
   *  back to /plan/return with the due still open; a lease a sweep holds is kept (REQ-099's rule)
   *  @throws settle-watch-invalid — a pick that names no due */
  async addSettleWatch(userId: string, pick: UserPlan, now: number): Promise<void> {
    if (!pick.dueId) throw new Error("settle-watch-invalid: the pick names no due");
    const kv = await this.kv();
    const key = keyOf({ phone: "", userId, kind: "settle-watch" });
    const existing = await kv.get<PendingCapture>(key);
    const at = new Date(now).toISOString();
    const previousDue = existing.value?.dueId;
    const rec: PendingCapture = {
      phone: "",
      userId,
      kind: "settle-watch",
      dueId: pick.dueId,
      pick,
      enqueuedAt: at,
      attempts: 0,
      nextAt: at,
      watchUntil: new Date(now + WATCH_FOR_MS).toISOString(),
      ...(existing.value?.leaseUntil ? { leaseUntil: existing.value.leaseUntil } : {}),
    };
    const op = kv.atomic().check(existing).set(key, rec).set([DUE_INDEX, pick.dueId], userId); // REQ-133 — findable by its due
    if (previousDue && previousDue !== pick.dueId) op.delete([DUE_INDEX, previousDue]);
    await op.commit();
  }

  /** REQ-133 — the account's watch that names the due, if any (the CRM's settled notice names the due alone) */
  async watchByDue(dueId: string): Promise<PendingCapture | null> {
    const kv = await this.kv();
    const userId = (await kv.get<string>([DUE_INDEX, dueId])).value;
    if (!userId) return null;
    const rec = (await kv.get<PendingCapture>(keyOf({ phone: "", userId, kind: "settle-watch" }))).value;
    return rec && rec.dueId === dueId ? rec : null;
  }

  /** REQ-133 — the watch's next look, set: no attempt counted, no error noted, the lease dropped —
   *  on the record as it stands now (a re-mark landing meanwhile is kept, REQ-113's rule) */
  async later(rec: PendingCapture, nextAt: number): Promise<PendingCapture> {
    const kv = await this.kv();
    const key = keyOf(rec);
    let next: PendingCapture = rec;
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
      const current = await kv.get<PendingCapture>(key);
      const base = current.value ?? rec;
      next = { ...unleased(base), nextAt: new Date(nextAt).toISOString() };
      if ((await kv.atomic().check(current).set(key, next).commit()).ok) return next;
    }
    await kv.set(key, next);
    return next;
  }

  /** REQ-131 — the account's watch, whatever it says: the due it watched activated its plan another way (/plan/return) */
  async dropSettleWatch(userId: string): Promise<void> {
    const kv = await this.kv();
    const key = keyOf({ phone: "", userId, kind: "settle-watch" });
    const current = await kv.get<PendingCapture>(key);
    const op = kv.atomic().delete(key);
    if (current.value?.dueId) op.delete([DUE_INDEX, current.value.dueId]);
    await op.commit();
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

  /** the attempt failed: count it, note why, and set the next time — on the record as it stands
   *  now: a save re-marking it between this read and this write is kept, never overwritten with
   *  the older mark (REQ-113: read again, write again until the write lands); the lease goes with
   *  the deferral */
  async defer(rec: PendingCapture, now: number, error: string): Promise<PendingCapture> {
    const kv = await this.kv();
    const key = keyOf(rec);
    let next: PendingCapture = rec;
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
      const current = await kv.get<PendingCapture>(key);
      const base = current.value ?? rec;
      const attempts = base.attempts + 1;
      next = { phone: base.phone, ...(base.origin ? { origin: base.origin } : {}), ...(base.userId ? { userId: base.userId } : {}), ...(base.kind ? { kind: base.kind } : {}), ...(base.back ? { back: base.back } : {}), ...(base.reason ? { reason: base.reason } : {}), ...(base.dueId ? { dueId: base.dueId } : {}), ...(base.pick ? { pick: base.pick } : {}), ...(base.watchUntil ? { watchUntil: base.watchUntil } : {}), enqueuedAt: base.enqueuedAt, attempts, nextAt: new Date(now + backoffMs(attempts)).toISOString(), lastError: error.slice(0, 300) };
      if ((await kv.atomic().check(current).set(key, next).commit()).ok) return next;
    }
    await kv.set(key, next); // moved under every attempt: the last write wins, as it used to
    return next;
  }

  /** the CRM answered for the record as the sweep claimed it: gone — unless it was re-marked
   *  meanwhile (REQ-099), in which case it stays, lease cleared, for the sweep that follows.
   *  REQ-113 — a save landing between this read and this write fails the version check: read
   *  again and write again until the write lands or the record is gone. A write lost here left the
   *  record re-marked AND leased for 90 s, and nobody clears a lease but this: under the gate's
   *  load the wizard's saves crossed the sweep's write and the stage never reached the CRM. */
  async done(rec: Pick<PendingCapture, "phone" | "userId" | "kind" | "enqueuedAt">): Promise<void> {
    const kv = await this.kv();
    const key = keyOf(rec);
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
      const current = await kv.get<PendingCapture>(key);
      if (!current.value) return;
      const op = kv.atomic().check(current);
      if (current.value.enqueuedAt === rec.enqueuedAt) op.delete(key);
      else op.set(key, unleased(current.value));
      if ((await op.commit()).ok) return;
    }
    // moved under every attempt: it is wanted again whatever it says now — left for the next sweep, unleased
    const last = await kv.get<PendingCapture>(key);
    if (last.value) await kv.set(key, unleased(last.value));
  }
}

/** the record without the lease a sweep held on it */
function unleased({ leaseUntil: _lease, ...rest }: PendingCapture): PendingCapture {
  return rest;
}
