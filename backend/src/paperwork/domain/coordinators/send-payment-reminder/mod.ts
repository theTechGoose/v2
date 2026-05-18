import { Injectable } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

/** The cadence steps fired by the overdue-reminder cron. */
export const CADENCE_DAYS = [3, 7, 14, 30] as const;
export type CadenceDay = typeof CADENCE_DAYS[number];

export interface ReminderResult {
  /** Invoice id we acted on. */
  invoiceId: string;
  /** Day step we fired (3/7/14/30). */
  day: CadenceDay;
  /** Channels we successfully dispatched on. */
  channels: string[];
  /** True when the Day-30 escalation was used (notifies contractor only,
   *  does NOT dispatch to the customer). */
  escalated: boolean;
}

/**
 * SendPaymentReminder — the overdue-cadence engine.
 *
 * Two run modes:
 *   - `runAll(userId, now)` — sweep ALL the user's invoices and fire the
 *     next-due cadence step for each one. Idempotent: each step appends
 *     a `reminderHistory` row, and we never re-fire a day we've already
 *     done.
 *   - `runForInvoice(userId, invoiceId, day, now)` — fire one specific
 *     step. Used by tests and manual "send nudge" buttons.
 *
 * Roadmap §E:
 *   - Day 3 / 7 / 14: text + email to customer.
 *   - Day 30: emit `invoice:escalated` for the contractor's bell only;
 *     no customer-facing dispatch (contractor decides whether to escalate
 *     manually).
 *   - Per-invoice mute: `remindersMuted=true` short-circuits the entire
 *     cadence for that invoice.
 *   - Eligibility: status in (sent|viewed|claimed) AND dueDate past.
 */
@Injectable()
export class SendPaymentReminder {
  constructor(
    private invoices: InvoiceStore,
    private customers: CustomerStore,
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private email: EmailService,
    private sms: SmsService,
    private shortlinks: ShortLinkStore,
    private bus: EventBus,
  ) {}

  async runAll(userId: string, now: Date = new Date()): Promise<ReminderResult[]> {
    const out: ReminderResult[] = [];
    const all = await this.invoices.listByUser(userId);
    for (const inv of all) {
      const day = pickNextDay(inv, now);
      if (day == null) continue;
      try {
        out.push(await this.runForInvoice(userId, inv.id, day, now));
      } catch (err) {
        console.error(`[send-payment-reminder] invoice=${inv.id} day=${day} failed:`, err);
      }
    }
    return out;
  }

  async runForInvoice(
    userId: string,
    invoiceId: string,
    day: CadenceDay,
    now: Date = new Date(),
  ): Promise<ReminderResult> {
    const invoice = await this.invoices.getOwned(invoiceId, userId);
    if (invoice.remindersMuted) {
      return { invoiceId, day, channels: [], escalated: false };
    }
    if (alreadyFiredOn(invoice, day)) {
      return { invoiceId, day, channels: [], escalated: false };
    }

    // Day-30 escalation: bell-only, no customer dispatch.
    if (day === 30) {
      try {
        await this.bus.emit({
          userId,
          entityType: "invoice",
          entityId: invoice.id,
          action: "escalated",
          data: { daysOverdue: daysOverdue(invoice, now) },
        });
      } catch (err) {
        console.error("[send-payment-reminder] bus emit failed:", err);
      }
      await this.appendHistory(userId, invoice, day, []);
      return { invoiceId, day, channels: [], escalated: true };
    }

    // Days 3 / 7 / 14: dispatch to customer.
    const [customer, sender, biz] = await Promise.all([
      invoice.customerId
        ? this.customers.getOwned(invoice.customerId, userId).catch(() => undefined)
        : Promise.resolve(undefined),
      this.users.get(userId).catch(() => undefined),
      this.identity.get(userId).catch(() => null),
    ]);
    const businessName = biz?.businessName?.trim() || biz?.legalName?.trim() || sender?.name?.trim() || "Paperwork Monster";
    const customerFirst = customer?.name?.trim().split(/\s+/)[0];
    const senderFirst = sender?.name?.trim().split(/\s+/)[0];
    const copy = composeReminderCopy({ day, customerFirst, senderFirst, businessName, invoice });

    // Mint a shortlink to the public invoice page for the SMS + email CTA.
    let url = "";
    try {
      const link = await this.shortlinks.findOrCreate(userId, "invoice", invoice.id);
      const appUrl = Deno.env.get("APP_URL") ?? "https://paperworkmonster.com";
      url = `${appUrl}/s/${link.code}`;
    } catch { /* fall through */ }

    const channels: string[] = [];
    if (customer?.email) {
      try {
        await this.email.send({
          to: customer.email,
          subject: copy.emailSubject,
          htmlBody: copy.emailHtml(url),
          ...(sender?.email ? { cc: [sender.email] } : {}),
        });
        channels.push("email");
      } catch (err) {
        console.error("[send-payment-reminder] email failed:", err);
      }
    }
    if (customer?.phoneNumber) {
      try {
        await this.sms.send({ to: customer.phoneNumber, body: copy.smsBody(url) });
        channels.push("sms");
      } catch (err) {
        console.error("[send-payment-reminder] sms failed:", err);
      }
    }

    await this.appendHistory(userId, invoice, day, channels);
    return { invoiceId, day, channels, escalated: false };
  }

  private async appendHistory(userId: string, invoice: Invoice, day: CadenceDay, channels: string[]): Promise<void> {
    const next = [...(invoice.reminderHistory ?? []), { day, sentAt: new Date().toISOString(), channels }];
    await this.invoices.update(invoice.id, userId, { reminderHistory: next });
  }
}

/** Pick the next eligible day to fire for `invoice`. Returns undefined
 *  if nothing's due (muted, paid, void, scheduled, draft, or within the
 *  past-due window of the next step but hasn't crossed it yet).
 *
 *  Cadence semantics:
 *    - Pick the LARGEST elapsed step that hasn't fired yet (so a
 *      contractor adopting the system mid-cycle on a 30-day-late
 *      invoice goes straight to Day 30 rather than the gentle Day-3
 *      copy).
 *    - Never regress: once Day N has fired, no step < N will fire.
 */
export function pickNextDay(invoice: Invoice, now: Date): CadenceDay | undefined {
  if (invoice.remindersMuted) return undefined;
  if (!["sent", "viewed", "claimed"].includes(invoice.status ?? "")) return undefined;
  const od = daysOverdue(invoice, now);
  if (od < CADENCE_DAYS[0]) return undefined;
  const firedDays = new Set((invoice.reminderHistory ?? []).map((h) => h.day));
  let largestFired: number | undefined;
  for (const d of CADENCE_DAYS) {
    if (firedDays.has(d)) largestFired = d;
  }
  for (let i = CADENCE_DAYS.length - 1; i >= 0; i--) {
    const d = CADENCE_DAYS[i];
    if (od < d) continue;
    if (firedDays.has(d)) continue;
    if (largestFired != null && d < largestFired) continue;
    return d;
  }
  return undefined;
}

export function daysOverdue(invoice: Invoice, now: Date): number {
  if (!invoice.dueDate) return 0;
  const due = new Date(`${invoice.dueDate}T23:59:59Z`);
  if (!Number.isFinite(due.getTime())) return 0;
  return Math.floor((now.getTime() - due.getTime()) / (24 * 3600 * 1000));
}

export function alreadyFiredOn(invoice: Invoice, day: CadenceDay): boolean {
  return (invoice.reminderHistory ?? []).some((h) => h.day === day);
}

/** Per-step copy. Pure function — pulled out for unit-test coverage. */
export function composeReminderCopy(opts: {
  day: CadenceDay;
  customerFirst: string | undefined;
  senderFirst: string | undefined;
  businessName: string;
  invoice: Invoice;
}): {
  emailSubject: string;
  emailHtml: (url: string) => string;
  smsBody: (url: string) => string;
} {
  const { day, customerFirst, senderFirst, businessName, invoice } = opts;
  const hi = customerFirst ? `Hi ${customerFirst}, ` : "";
  const sender = senderFirst ?? "your contractor";
  const amount = `$${((invoice.amount ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const tone = day === 3
    ? `quick check-in — your invoice from ${businessName} is still open.`
    : day === 7
    ? `following up on your invoice from ${businessName} — let me know if there's anything I can help with.`
    : `wanted to follow up personally on your invoice from ${businessName}. Best way to wrap this up?`;
  return {
    emailSubject:
      day === 3
        ? `Quick check-in: invoice from ${businessName}`
        : day === 7
        ? `Following up: invoice from ${businessName}`
        : `Personal note from ${sender}`,
    emailHtml: (url: string) => `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f7f6f1;font-family:-apple-system,sans-serif;color:#1c2c30">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:28px 32px">
    <p style="margin:0;font-size:15px;line-height:1.55">${hi}${tone}</p>
    <p style="margin:14px 0 0;font-size:15px"><strong>Amount due:</strong> ${amount}${invoice.dueDate ? ` · Due ${invoice.dueDate}` : ""}</p>
    ${url ? `<p style="margin:18px 0 0"><a href="${url}" style="display:inline-block;background:#519843;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">Open invoice</a></p>` : ""}
    <p style="margin:18px 0 0;font-size:13px;color:#6b7a7e">${sender}</p>
  </div>
</body></html>`,
    smsBody: (url: string) => `${hi}${tone} ${amount}${url ? ` — ${url}` : ""}${senderFirst ? ` — ${senderFirst}` : ""}`,
  };
}
