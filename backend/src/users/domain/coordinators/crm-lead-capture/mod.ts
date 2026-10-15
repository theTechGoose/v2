/**
 * REQ-072 — Raphael: "fire and forget … it passes it to the backend and it does not block the
 * user. it MUST be guaranteed to go in the crm this is mission critical."
 *
 * enqueue(phone): the lead is a KV outbox record (CrmCaptureOutbox) before the login replies —
 * a few ms — and a sweep starts without being awaited. drain(): every due record is claimed,
 * carried to the CRM (CrmCustomerSync.capture, REQ-060's lead) and cleared on the CRM's
 * answer; a failure defers it with backoff (lead-capture-retry) and it is never dropped. Sweeps
 * run on every login, at boot (an isolate that died mid-capture leaves its record for the next
 * one) and every minute on Deno Deploy's cron (registerSweep). One sweep per process at a time;
 * a lease keeps two processes off one record.
 */
import { Injectable } from "#danet/core";
import { CrmCaptureOutbox } from "@users/domain/data/crm-capture-outbox/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { isDue } from "@users/domain/business/lead-capture-retry/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";

export interface SweepResult {
  landed: number;
  deferred: number;
  waiting: number;
  /** REQ-073 — the sweep could not read its outbox (KV down): nothing was sent, the records stay */
  failed?: string;
}

/** REQ-073 — the platform's cron, injected so a registration that rejects can be proven held */
export type CronRegister = (name: string, schedule: string, handler: () => Promise<void>) => unknown;
const SWEEP_NAME = "crm-lead-capture sweep";
const EVERY_MINUTE = "* * * * *";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const LOUD_AFTER_ATTEMPTS = 5;

@Injectable()
export class CrmLeadCapture {
  private inFlight: Promise<SweepResult> | null = null;

  constructor(private outbox: CrmCaptureOutbox, private crm: CrmCustomerSync) {}

  /** durable at once; the CRM is reached by the sweep this starts, never by the caller's request */
  async enqueue(phoneNumber: string): Promise<void> {
    await this.outbox.add(normalizePhone(phoneNumber), Date.now());
    void this.drain();
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
      try {
        await this.crm.capture(rec.phone);
        await this.outbox.done(rec.phone);
        result.landed++;
      } catch (e) {
        const why = message(e);
        const next = await this.outbox.defer(rec, Date.now(), why);
        result.deferred++;
        const line = `[crm-lead-capture] ${rec.phone} attempt ${next.attempts} failed, next at ${next.nextAt}: ${why}`;
        if (next.attempts >= LOUD_AFTER_ATTEMPTS) console.error(`${line} — STILL NOT IN THE CRM`);
        else console.warn(line);
      }
    }
    return result;
  }

  /**
   * Deno Deploy runs Deno.cron; where it is not enabled (a local run without --unstable-cron) there
   * is no minute sweep — logins and boots still sweep. REQ-073: whatever the registration does —
   * throw now, reject later, or not exist — is logged and never ends the process.
   */
  registerSweep(cron: CronRegister | undefined = (Deno as unknown as { cron?: CronRegister }).cron): boolean {
    if (typeof cron !== "function") {
      console.warn("[crm-lead-capture] no minute sweep: Deno.cron is not available here; logins and boots sweep");
      return false;
    }
    try {
      const registration = cron(SWEEP_NAME, EVERY_MINUTE, async () => {
        await this.drain();
      });
      if (registration && typeof (registration as Promise<unknown>).then === "function") {
        (registration as Promise<unknown>).then(undefined, (e: unknown) => {
          console.warn(`[crm-lead-capture] the minute sweep's registration was refused; logins and boots sweep: ${message(e)}`);
        });
      }
      return true;
    } catch (e) {
      console.warn(`[crm-lead-capture] no minute sweep: ${message(e)}`);
      return false;
    }
  }
}
