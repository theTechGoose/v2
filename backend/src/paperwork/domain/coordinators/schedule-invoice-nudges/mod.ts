import { Injectable } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

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
            dayBucket: now.toISOString().slice(0, 10),
          },
        });
        out.push({ invoiceId: inv.id, scheduledFor: inv.scheduledFor ?? "" });
      } catch (err) {
        console.error(`[schedule-invoice-nudges] emit failed for invoice=${inv.id}:`, err);
      }
    }
    return out;
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
