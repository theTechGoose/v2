import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { SendPaymentReminder } from "@paperwork/domain/coordinators/send-payment-reminder/mod.ts";
import { ScheduleInvoiceNudges } from "@paperwork/domain/coordinators/schedule-invoice-nudges/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

/**
 * CronController — manual trigger endpoints for the daily cadences.
 *
 * These endpoints exist so an external scheduler (Deno Deploy cron, a
 * vendor like Trigger.dev, or even a contractor manually) can fire the
 * payment-reminder + scheduled-invoice-nudge sweeps without standing
 * up a long-running background worker.
 *
 * Per-user gating: caller must be authenticated, and the sweep only
 * touches their own invoices. To run the cadence on someone else's
 * account, a separate admin endpoint (out of v1 scope) would need to
 * pass through a service-token check.
 *
 * In production, a single cron line like:
 *   0 14 * * *  curl -H "x-session-id: $TOKEN" .../cron/run-reminders
 * triggers the user's daily sweep at 2pm UTC.
 */
@Controller("cron")
export class CronController {
  constructor(
    private reminders: SendPaymentReminder,
    private nudges: ScheduleInvoiceNudges,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  /** Sweep all the caller's overdue invoices and fire the next-due
   *  cadence step for each. Idempotent: history rows prevent re-fires. */
  @Post("run-reminders")
  async runReminders(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const results = await this.reminders.runAll(user.id, new Date());
    return ctx.json({ ok: true, count: results.length, results });
  }

  /** Sweep the caller's scheduled invoices and emit a chat-style nudge
   *  for any whose scheduledFor is today/tomorrow. */
  @Post("run-nudges")
  async runNudges(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const results = await this.nudges.runForUser(user.id, new Date());
    return ctx.json({ ok: true, count: results.length, results });
  }

  /** Single-invoice manual reminder — backs the "Send nudge" button on
   *  the overdue card. Body: { day: 3 | 7 | 14 | 30 }. */
  @Post("invoice-reminder")
  async oneOffReminder(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = (body ?? {}) as { invoiceId?: string; day?: number };
    if (!b.invoiceId || ![3, 7, 14, 30].includes(b.day ?? -1)) {
      throw new Error("invoiceId + day∈{3,7,14,30} are required");
    }
    const out = await this.reminders.runForInvoice(user.id, b.invoiceId, b.day as 3 | 7 | 14 | 30, new Date());
    return ctx.json(out);
  }
}
