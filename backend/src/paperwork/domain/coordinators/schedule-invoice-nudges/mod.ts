import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

/** REQ-508 — what one server sweep did; `ran` is false when another sweep holds the lease */
export interface NudgeSweep {
  ran: boolean;
  accounts: number;
  nudged: number;
}

/** REQ-508 — the timer ticks every minute (REQ-074); a sweep runs at most this often across isolates */
export const NUDGE_SWEEP_EVERY_MS = 15 * 60_000;
const EVERY_MINUTE_MS = 60_000;
const LEASE_KEY: Deno.KvKey = ["invoice_nudge_sweep"];
const INDEX_PREFIX = "invoice_by_user";
type Timer = (fn: () => void, ms: number) => number;
type Unref = (id: number) => void;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface NudgeResult {
  invoiceId: string;
  /** scheduledFor at the moment of nudge — useful for logging + idempotency tests. */
  scheduledFor: string;
}

/**
 * ScheduleInvoiceNudges — daily cron that surfaces scheduled milestone
 * invoices to the contractor as chat-style nudges with one-tap Send /
 * Postpone / Edit CTAs.
 *
 * Eligibility: status=`scheduled` AND `scheduledFor <= today + 1 day`.
 * We use a one-day lookahead so the nudge surfaces the *morning* of the
 * suggested send date, not in the evening of the day before.
 *
 * Idempotency: we emit an `invoice:nudge_due` domain event with a
 * day-bucketed key. The notify-on-event side dedupes per (invoiceId,
 * yyyy-mm-dd) so the cron is safe to re-run during the day.
 *
 * REQ-508 (demo-loop cycle 3, m20) — the sweep runs on the server, never on a page view: the
 * /invoices island used to POST /cron/run-nudges on every load (REQ-022's stand-in for a
 * scheduler). Now `registerSweep` (REQ-074's pattern: a minute timer in the isolate, never
 * Deno.cron) ticks `sweep`, which takes a KV lease so one isolate sweeps every account with
 * invoices once per NUDGE_SWEEP_EVERY_MS, and claims (invoiceId, day) in KV before it emits, so
 * each invoice's nudge event fires once a day. POST /cron/run-nudges stays as a manual trigger.
 */
@Injectable()
export class ScheduleInvoiceNudges {
  constructor(
    private invoices: InvoiceStore,
    private bus: EventBus,
  ) {}

  async runForUser(userId: string, now: Date = new Date()): Promise<NudgeResult[]> {
    const all = await this.invoices.listByUser(userId);
    const due = all.filter((inv) => isNudgeDue(inv, now));
    const out: NudgeResult[] = [];
    for (const inv of due) {
      try {
        await this.emitNudge(userId, inv, now.toISOString().slice(0, 10));
        out.push({ invoiceId: inv.id, scheduledFor: inv.scheduledFor ?? "" });
      } catch (err) {
        console.error(`[schedule-invoice-nudges] emit failed for invoice=${inv.id}:`, err);
      }
    }
    return out;
  }

  /** REQ-508 — every account with invoices, swept by whichever isolate takes the lease; never throws */
  async sweep(now: Date = new Date()): Promise<NudgeSweep> {
    const idle: NudgeSweep = { ran: false, accounts: 0, nudged: 0 };
    let accounts: string[];
    try {
      if (!await this.takeLease(now)) return idle;
      accounts = await this.accounts();
    } catch (err) {
      console.error(`[schedule-invoice-nudges] sweep could not start: ${message(err)}`);
      return idle;
    }
    let nudged = 0;
    for (const userId of accounts) {
      try {
        nudged += await this.sweepAccount(userId, now);
      } catch (err) {
        console.error(`[schedule-invoice-nudges] sweep of ${userId} failed: ${message(err)}`);
      }
    }
    return { ran: true, accounts: accounts.length, nudged };
  }

  /** REQ-508 (REQ-074's pattern) — a minute timer while the isolate lives, unref'd; never Deno.cron; never throws */
  registerSweep(
    timer: Timer = (fn, ms) => setInterval(fn, ms) as unknown as number,
    unref: Unref = (id) => Deno.unrefTimer(id),
  ): boolean {
    try {
      const id = timer(() => {
        void this.sweep();
      }, EVERY_MINUTE_MS);
      unref(id);
      return true;
    } catch (err) {
      console.warn(`[schedule-invoice-nudges] no minute sweep: ${message(err)}`);
      return false;
    }
  }

  /** the lease: the last sweep's start, replaced atomically once NUDGE_SWEEP_EVERY_MS has passed */
  private async takeLease(now: Date): Promise<boolean> {
    const kv = await getKv();
    const held = await kv.get<number>(LEASE_KEY);
    if (typeof held.value === "number" && now.getTime() - held.value < NUDGE_SWEEP_EVERY_MS) return false;
    const r = await kv.atomic().check(held).set(LEASE_KEY, now.getTime()).commit();
    return r.ok;
  }

  /** each account under the invoice index, one KV read per account (skips past its invoices) */
  private async accounts(): Promise<string[]> {
    const kv = await getKv();
    const ids: string[] = [];
    let start: Deno.KvKey | undefined;
    for (;;) {
      const selector = start ? { prefix: [INDEX_PREFIX], start } : { prefix: [INDEX_PREFIX] };
      let next: string | undefined;
      for await (const e of kv.list({ ...selector }, { limit: 1 })) {
        if (typeof e.key[1] === "string") next = e.key[1];
      }
      if (next === undefined) return ids;
      ids.push(next);
      start = [INDEX_PREFIX, next, true]; // booleans sort after every string id
    }
  }

  private async sweepAccount(userId: string, now: Date): Promise<number> {
    const day = now.toISOString().slice(0, 10);
    const due = (await this.invoices.listByUser(userId)).filter((inv) => isNudgeDue(inv, now));
    if (!due.length) return 0;
    const kv = await getKv();
    let n = 0;
    for (const inv of due) {
      const key = ["invoice_nudge_sent", inv.id, day];
      const claimed = await kv.atomic().check({ key, versionstamp: null })
        .set(key, now.toISOString(), { expireIn: 3 * 24 * 3600 * 1000 }).commit();
      if (!claimed.ok) continue;
      try {
        await this.emitNudge(userId, inv, day);
        n++;
      } catch (err) {
        await kv.delete(key); // not delivered: the next sweep tries again
        console.error(`[schedule-invoice-nudges] emit failed for invoice=${inv.id}: ${message(err)}`);
      }
    }
    return n;
  }

  private async emitNudge(userId: string, inv: Invoice, dayBucket: string): Promise<void> {
    await this.bus.emit({
      userId,
      entityType: "invoice",
      entityId: inv.id,
      action: "nudge_due",
      data: {
        installmentIndex: inv.installmentIndex ?? 0,
        installmentTotal: inv.installmentTotal ?? 0,
        amount: inv.amount ?? 0,
        scheduledFor: inv.scheduledFor ?? "",
        dayBucket,
      },
    });
  }
}

/** Pure predicate: should the cron fire a nudge for this invoice today? */
export function isNudgeDue(inv: Invoice, now: Date): boolean {
  if (inv.status !== "scheduled") return false;
  if (!inv.scheduledFor) return false;
  const target = new Date(`${inv.scheduledFor}T00:00:00Z`);
  if (!Number.isFinite(target.getTime())) return false;
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
  return target.getTime() <= tomorrow.getTime();
}
