/**
 * REQ-072 — Raphael: "fire and forget … it passes it to the backend and it does not block the
 * user. it MUST be guaranteed to go in the crm this is mission critical."
 *
 * enqueue(phone): the lead is a KV outbox record (CrmCaptureOutbox) before the login replies —
 * a few ms — and a sweep starts without being awaited. drain(): every due record is claimed,
 * carried to the CRM (CrmCustomerSync.capture, REQ-060's lead) and cleared on the CRM's
 * answer; a failure defers it with backoff (lead-capture-retry) and it is never dropped. Sweeps
 * run on every login, at boot (an isolate that died mid-capture leaves its record for the next
 * one) and every minute while the isolate lives, on a timer (registerSweep; REQ-074 — never
 * Deno.cron: a revision that calls it never routes on Deno Deploy). A lease keeps two sweeps off
 * one record; drain() joins the sweep in flight. REQ-128 — Raphael, 2026-11-02, on REQ-060's story
 * failing beside REQ-106's slow mint: "can you please fix it?" — a record that arrives while a
 * sweep is in flight is carried AT ONCE by a pass of its own (`kick` starts one beside the sweep;
 * the leases and the KV-atomic claim keep the two off one record), never after the slow one; a
 * record that pass found held (REQ-099's re-mark, under the sweep's lease) is carried by the sweep
 * that follows (`again`).
 *
 * REQ-098 — Raphael, 2026-10-20, on prod's sign-up sitting after the code: "it should fire the
 * event to the backend and forget about it while the backend finishes the request." The account's
 * CRM customer (REQ-058) rides the same outbox: enqueueSync(userId) is the record before the
 * verify replies, and the sweep makes or revises the customer (CrmCustomerSync.ensure) after it.
 * REQ-099 — "every fucking onboarding question makes me wait": the wizard's saves (PUT /me,
 * PUT /profile/identity, POST /me/onboarded, the plan's tier changes) enqueue the same record;
 * a record re-marked while a sweep holds it is carried again by the sweep that follows (the
 * outbox's done() leaves it), so the CRM ends up with the profile as last saved.
 * REQ-103 — Raphael, 2026-10-20: "if somone signs up we need to generate an email to
 * hello@documonster.com." That email rides the same outbox: enqueueSignupNotice(userId) is the record
 * before the sign-up replies, and the sweep mails it (SignupNotice.send) after — a mail Postmark
 * refused is deferred and retried like a CRM refusal, never dropped.
 * REQ-106 — Raphael, 2026-10-20: "when i click a plan in the onboarding flow the payment link
 * takes FOREVER to load … i dont care if it happens asyncronously … what i care about is that the
 * user experience is good." The paid pick's three CRM calls — the customer, the first month's due,
 * the pay link — ride the same outbox: enqueuePayLink(userId, back) is the record before the pick
 * replies, and the sweep mints them (PayLinkMint) after it, onto the plan's record. The CRM's
 * refusal by name is final (the record is cleared, the plan reads it); anything else is deferred
 * and retried like the rest. A newer pick re-marks the record, like a newer save does.
 * REQ-131 — Raphael, 2026-11-02, on Alex's $99 approved by the gateway while the CRM still read the
 * due open: "figure out why the hell it never logged Alex's payment" / "fix it." The due a page
 * was minted for rides the outbox too, from the moment the page is (the sweep adds the watch right
 * after the mint) and again whenever /plan/return finds it still open: the sweep asks the CRM
 * (SettleWatch) until it settles — open, the record waits on its backoff; settled, the plan is
 * active (the pick restored if a later unpaid pick buried it), the tier and the paid notice follow.
 */
import { Injectable } from "#danet/core";
import { CrmCaptureOutbox } from "@users/domain/data/crm-capture-outbox/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { SignupNotice } from "@users/domain/coordinators/signup-notice/mod.ts";
import { PayLinkMint } from "@users/domain/coordinators/pay-link-mint/mod.ts";
import { SettleWatch } from "@users/domain/coordinators/settle-watch/mod.ts";
import { type NoticeReason, noticeReasonOf } from "@users/domain/business/signup-notice/mod.ts";
import { type PickBack, pickBackOf } from "@users/domain/business/plan/mod.ts";
import { isDue, type PendingCapture, WATCH_EVERY_MS } from "@users/domain/business/lead-capture-retry/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import type { UserPlan } from "@users/dto/plan.ts";

export interface SweepResult {
  landed: number;
  deferred: number;
  waiting: number;
  /** REQ-073 — the sweep could not read its outbox (KV down): nothing was sent, the records stay */
  failed?: string;
}

/** REQ-074 — the isolate's interval timer, injected so a tick can be driven by hand */
export type Timer = (handler: () => void, ms: number) => number;
/** REQ-074 — lets the process end with the timer pending (Deno.unrefTimer) */
export type Unref = (id: number) => void;
const EVERY_MINUTE_MS = 60_000;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const LOUD_AFTER_ATTEMPTS = 5;
/** lanes carried at once: enough that one slow person never queues the rest, few enough for a CRM to take */
const LANES_AT_ONCE = 8;

@Injectable()
export class CrmLeadCapture {
  /** the sweep drain() joins */
  private inFlight: Promise<SweepResult> | null = null;
  /** REQ-128 — the passes a kick started beside it, for the records that arrived meanwhile */
  private extra = new Set<Promise<SweepResult>>();
  /** a record arrived while a sweep was on its list and was found held by it (REQ-099's re-mark):
   *  sweep again right after */
  private again = false;

  constructor(private outbox: CrmCaptureOutbox, private crm: CrmCustomerSync, private notice: SignupNotice, private payLink: PayLinkMint, private watch: SettleWatch) {}

  /** durable at once; the CRM is reached by the sweep this starts, never by the caller's request */
  async enqueue(phoneNumber: string): Promise<void> {
    await this.outbox.add(normalizePhone(phoneNumber), Date.now());
    this.kick();
  }

  /** REQ-098 — the account's CRM customer, durable at once; made or revised by the sweep this
   *  starts, never by the caller's request */
  async enqueueSync(userId: string): Promise<void> {
    await this.outbox.addSync(userId, Date.now());
    this.kick();
  }

  /** REQ-103 — the new account's email to hello@documonster.com, durable at once; mailed by the
   *  sweep this starts, never by the sign-up's reply. REQ-112 — saying what happened: signed up,
   *  completed onboarding, skipped setup, paid */
  async enqueueSignupNotice(userId: string, reason: NoticeReason = "signed up"): Promise<void> {
    await this.outbox.addSignupNotice(userId, reason, Date.now());
    this.kick();
  }

  /** REQ-106 — the paid pick's pay page, durable at once; the CRM's customer, due and link are
   *  made by the sweep this starts, never by the pick's reply */
  async enqueuePayLink(userId: string, back: PickBack): Promise<void> {
    await this.outbox.addPayLink(userId, back, Date.now());
    this.kick();
  }

  /** REQ-131 — the due of `pick`, watched until it settles (asked at once); a watch already on
   *  the outbox is re-marked: its clock and its window restart */
  async enqueueSettleWatch(userId: string, pick: UserPlan): Promise<void> {
    await this.outbox.addSettleWatch(userId, pick, Date.now());
    this.kick();
  }

  /** REQ-131 — the account's watch is moot: a read found the due settled and activated the plan */
  async dropSettleWatch(userId: string): Promise<void> {
    await this.outbox.dropSettleWatch(userId);
  }

  /** REQ-133 — the CRM says the due settled: the watch that names it is looked at now, by a pass
   *  of its own, not at its minute; false when no watch names the due (nothing to look at) */
  async lookNow(dueId: string): Promise<boolean> {
    const rec = await this.outbox.watchByDue(dueId);
    if (!rec) return false;
    await this.outbox.later(rec, Date.now());
    this.kick();
    return true;
  }

  private kick(): void {
    if (!this.inFlight) {
      void this.drain();
      return;
    }
    // REQ-128 — a sweep is on its list (held, maybe, by one slow CRM call): this record is carried
    // now by a pass of its own; a record that pass could not claim is held by the sweep — swept again after
    const pass: Promise<SweepResult> = this.pass(Date.now())
      .then((r) => {
        if (r.waiting > 0) this.again = true;
        return r;
      })
      .finally(() => {
        this.extra.delete(pass);
        this.followUp();
      });
    this.extra.add(pass);
  }

  /** the sweeps and passes this process has in flight or flagged to follow, settled — what a test
   *  awaits after a reply whose work rides the outbox (a record held by a sweep is carried by the
   *  one that follows, REQ-099) */
  async idle(): Promise<void> {
    while (this.inFlight || this.extra.size > 0) {
      await Promise.allSettled([...(this.inFlight ? [this.inFlight] : []), ...this.extra]);
    }
  }

  private followUp(): void {
    if (!this.inFlight && this.again) {
      this.again = false;
      void this.drain();
    }
  }

  /** Danet's app-close hook (called by name on every injectable): the app closing waits for the
   *  sweep in flight, so its records land in the store it read them from, never in whatever store
   *  opens next (a test's fresh KV saw another test's user deferred into it, REQ-112) */
  async onAppClose(): Promise<void> {
    await this.idle();
  }

  /** never rejects (REQ-073): a sweep that cannot read its outbox is logged and the records wait */
  drain(now: number = Date.now()): Promise<SweepResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.pass(now).finally(() => {
      this.inFlight = null;
      this.followUp();
    });
    return this.inFlight;
  }

  /** one pass over the outbox, settled: a pass that cannot read it is logged and the records wait */
  private pass(now: number): Promise<SweepResult> {
    return this.sweep(now).catch((e: unknown): SweepResult => {
      const failed = message(e);
      console.error(`[crm-lead-capture] sweep failed before anything was sent; the records stay for the next sweep: ${failed}`);
      return { landed: 0, deferred: 0, waiting: 0, failed };
    });
  }

  /**
   * One lane per person — the lead by its phone, the account by its id — carried at once, LANES_AT_ONCE
   * at a time, each lane in order: one account's slow CRM call (a cold start, a pay page's mint)
   * never holds another's record (REQ-111: the stage reaches the CRM while another account's pay
   * page is being made). The leads go first, so a phone's lead is on the CRM before the account
   * that phone just opened is synced (REQ-072 before REQ-098).
   */
  private async sweep(now: number): Promise<SweepResult> {
    const result: SweepResult = { landed: 0, deferred: 0, waiting: 0 };
    const leads: PendingCapture[][] = [];
    const accounts = new Map<string, PendingCapture[]>();
    for (const rec of await this.outbox.list()) {
      if (!rec.userId) leads.push([rec]);
      else {
        const lane = accounts.get(rec.userId);
        if (lane) lane.push(rec);
        else accounts.set(rec.userId, [rec]);
      }
    }
    await this.lanes(leads, now, result);
    await this.lanes([...accounts.values()], now, result);
    return result;
  }

  private async lanes(lanes: PendingCapture[][], now: number, result: SweepResult): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (next < lanes.length) {
        const lane = lanes[next++];
        for (const rec of lane) await this.carry(rec, now, result);
      }
    };
    await Promise.all(Array.from({ length: Math.min(LANES_AT_ONCE, lanes.length) }, worker));
  }

  private async carry(rec: PendingCapture, now: number, result: SweepResult): Promise<void> {
    if (!isDue(rec, now) || !(await this.outbox.claim(rec, now))) {
      result.waiting++;
      return;
    }
    if (rec.kind === "settle-watch") return await this.watchDue(rec, now, result); // REQ-131
    const who = rec.kind === "signup-notice" ? `signup notice for ${rec.userId}` : rec.kind === "pay-link" ? `pay page of ${rec.userId}` : rec.userId ? `customer of ${rec.userId}` : rec.phone;
    try {
      if (rec.kind === "signup-notice") await this.notice.send(rec.userId ?? "", noticeReasonOf(rec.reason)); // REQ-103/112
      else if (rec.kind === "pay-link") {
        const page = await this.payLink.mint(rec.userId ?? "", pickBackOf(rec.back)); // REQ-106
        // REQ-131 — the due is watched from the moment its page is on the record
        if (page?.status === "pending" && page.dueId && page.payUrl) await this.outbox.addSettleWatch(rec.userId ?? "", page, Date.now());
      } else if (rec.userId) await this.crm.ensure(rec.userId); // REQ-098
      else await this.crm.capture(rec.phone);
      await this.outbox.done(rec);
      result.landed++;
    } catch (e) {
      const why = message(e);
      const next = await this.outbox.defer(rec, Date.now(), why);
      result.deferred++;
      const line = `[crm-lead-capture] ${who} attempt ${next.attempts} failed, next at ${next.nextAt}: ${why}`;
      const still = rec.kind === "signup-notice" ? "STILL NOT MAILED" : rec.kind === "pay-link" ? "STILL NO PAY PAGE" : "STILL NOT IN THE CRM";
      if (next.attempts >= LOUD_AFTER_ATTEMPTS) console.error(`${line} — ${still}`);
      else console.warn(line);
    }
  }

  /**
   * REQ-131 — the due a page was minted for, asked until it settles. Open: the record waits a
   * minute (REQ-133: a fixed cadence, never a backoff or an error — a page nobody has paid yet is
   * the ordinary case; the CRM's settled notice makes the watch look sooner). Settled: the plan
   * is active (SettleWatch — the pick it paid for, restored if a later unpaid pick buried it) and
   * the tier (REQ-062/099) and the paid notice (REQ-112) ride the outbox, carried at once. A window
   * passed unpaid ends the watch; the plan stays as stored.
   */
  private async watchDue(rec: PendingCapture, now: number, result: SweepResult): Promise<void> {
    const who = `due ${rec.dueId} of ${rec.userId}`;
    try {
      if (rec.watchUntil && Date.parse(rec.watchUntil) <= now) {
        console.warn(`[crm-lead-capture] ${who}: unpaid for 48 h — the watch ends, the plan stays as stored`);
      } else {
        const outcome = await this.watch.check(rec.userId ?? "", rec.dueId ?? "", rec.pick ?? null);
        if (outcome.kind === "waiting") {
          await this.outbox.later(rec, Date.now() + WATCH_EVERY_MS); // REQ-133 — a minute on, no backoff, no error
          result.waiting++;
          return;
        }
        if (outcome.kind === "nothing") console.log(`[crm-lead-capture] ${who}: settled, nothing to write — ${outcome.why}`);
        else {
          console.log(`[crm-lead-capture] ${who}: settled — ${outcome.plan.planId} ${outcome.kind === "restored" ? "restored, " : ""}active`);
          await this.enqueueSync(rec.userId ?? "");
          await this.enqueueSignupNotice(rec.userId ?? "", "paid");
        }
      }
      await this.outbox.done(rec);
      result.landed++;
    } catch (e) {
      const why = message(e);
      const next = await this.outbox.defer(rec, Date.now(), why);
      result.deferred++;
      console.warn(`[crm-lead-capture] ${who} attempt ${next.attempts} failed, next at ${next.nextAt}: ${why}`);
    }
  }

  /**
   * REQ-074 — the minute sweep is a timer inside the isolate, never Deno.cron: on Deno Deploy a
   * revision that calls Deno.cron warms up and then fails at routing (three preview deployments
   * of main @ 980fe04 proved it: the cron in bootstrap, the cron at mod.ts top level — both
   * failed; no cron — routed). The timer is unref'd so it never holds a process open; it sweeps
   * while the isolate lives, and logins and boots sweep the rest. REQ-073 still holds: whatever
   * the timer does — throw, or not exist — is logged and never ends the process.
   */
  registerSweep(timer: Timer = (fn, ms) => setInterval(fn, ms) as unknown as number, unref: Unref = (id) => Deno.unrefTimer(id)): boolean {
    try {
      const id = timer(() => {
        void this.drain();
      }, EVERY_MINUTE_MS);
      unref(id);
      return true;
    } catch (e) {
      console.warn(`[crm-lead-capture] no minute sweep: ${message(e)}; logins and boots sweep`);
      return false;
    }
  }
}
