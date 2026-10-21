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
 * Deno.cron: a revision that calls it never routes on Deno Deploy). One sweep per process at a
 * time; a lease keeps two processes off one record; a record enqueued while a sweep runs is swept
 * right after it.
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
 */
import { Injectable } from "#danet/core";
import { CrmCaptureOutbox } from "@users/domain/data/crm-capture-outbox/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { SignupNotice } from "@users/domain/coordinators/signup-notice/mod.ts";
import { PayLinkMint } from "@users/domain/coordinators/pay-link-mint/mod.ts";
import { type NoticeReason, noticeReasonOf } from "@users/domain/business/signup-notice/mod.ts";
import { type PickBack, pickBackOf } from "@users/domain/business/plan/mod.ts";
import { isDue } from "@users/domain/business/lead-capture-retry/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";

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

@Injectable()
export class CrmLeadCapture {
  private inFlight: Promise<SweepResult> | null = null;
  /** a record arrived while a sweep was on its list: sweep again right after */
  private again = false;

  constructor(private outbox: CrmCaptureOutbox, private crm: CrmCustomerSync, private notice: SignupNotice, private payLink: PayLinkMint) {}

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

  private kick(): void {
    if (this.inFlight) this.again = true;
    void this.drain();
  }

  /** the sweeps this process has in flight or flagged to follow, settled — what a test awaits after
   *  a reply whose work rides the outbox (a sweep kicked while one runs follows it, REQ-099) */
  async idle(): Promise<void> {
    while (this.inFlight) await this.inFlight;
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
    this.inFlight = this.sweep(now)
      .catch((e: unknown): SweepResult => {
        const failed = message(e);
        console.error(`[crm-lead-capture] sweep failed before anything was sent; the records stay for the next sweep: ${failed}`);
        return { landed: 0, deferred: 0, waiting: 0, failed };
      })
      .finally(() => {
        this.inFlight = null;
        if (this.again) {
          this.again = false;
          void this.drain();
        }
      });
    return this.inFlight;
  }

  private async sweep(now: number): Promise<SweepResult> {
    const result: SweepResult = { landed: 0, deferred: 0, waiting: 0 };
    for (const rec of await this.outbox.list()) {
      if (!isDue(rec, now) || !(await this.outbox.claim(rec, now))) {
        result.waiting++;
        continue;
      }
      const who = rec.kind === "signup-notice" ? `signup notice for ${rec.userId}` : rec.kind === "pay-link" ? `pay page of ${rec.userId}` : rec.userId ? `customer of ${rec.userId}` : rec.phone;
      try {
        if (rec.kind === "signup-notice") await this.notice.send(rec.userId ?? "", noticeReasonOf(rec.reason)); // REQ-103/112
        else if (rec.kind === "pay-link") await this.payLink.mint(rec.userId ?? "", pickBackOf(rec.back)); // REQ-106
        else if (rec.userId) await this.crm.ensure(rec.userId); // REQ-098
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
    return result;
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
