import { Injectable } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { businessFrom } from "@communication/domain/business/sender/mod.ts";
import { emailLogo, emailLogoHtml } from "@paperwork/domain/business/email-logo/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { emailRoot } from "@paperwork/domain/business/email-root/mod.ts"; // REQ-1033
import type { Invoice } from "@paperwork/dto/invoice.ts";
import { SITE_ORIGIN } from "#quote-flow/site-meta.ts";
import { invoiceBalance } from "#documents/versions.ts"; // REQ-1028
import { formatUsdCents } from "#quote-flow/money-text.ts"; // REQ-1109
import {
  customerOnDocument,
  docRef,
  docRefWithVersion,
  docTitle,
} from "@paperwork/domain/business/doc-render/mod.ts";
import {
  daysFromDue,
  DEFAULT_REMINDER_DAYS,
  REMINDER_DAY_CHOICES,
  type ReminderDay,
  reminderSettingsOf,
} from "#quote-flow/reminder-settings.ts";
import { resolveCommsLanguage } from "#quote-flow/comms-language.ts"; // REQ-715
import { formatLongDate } from "#quote-flow/format-helpers.ts"; // REQ-1115
import { withSendLang } from "#quote-flow/share-link.ts"; // REQ-715
import { fmtPaperworkDate } from "#quote-flow/email-format.ts"; // REQ-1111
import { phoneCantReceiveTexts } from "#quote-flow/sms-number.ts"; // REQ-1113
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts"; // REQ-784
import { customerLabel } from "@communication/domain/business/outbox-entry/mod.ts"; // REQ-784
import { ConversationStore } from "@communication/domain/data/conversation-store/mod.ts"; // REQ-784
import { MessageStore } from "@communication/domain/data/message-store/mod.ts"; // REQ-784

/** Every cadence step, in order (days relative to the due date): -3 = three
 *  days before, 0 = the due date (REQ-704, demo cycle 5 m60), 3 / 7 / 14 past
 *  due, 30 = the owner-only escalation. A business picks which run
 *  (REQ-623: BusinessIdentity.reminders.days); unset → 3 / 7 / 14 / 30. */
export const CADENCE_DAYS = REMINDER_DAY_CHOICES;
export type CadenceDay = ReminderDay;

/** REQ-704: what a nudge would send, rendered without sending it. */
export interface ReminderPreview {
  invoiceId: string;
  day: CadenceDay;
  /** Day 30: nothing reaches the customer, the owner is alerted. */
  escalated: boolean;
  email?: string;
  phone?: string;
  /** REQ-1113: the channels a send would use, in send order — the email
   *  when there is an address, the text only when the phone can take one. */
  channels: ReminderChannel[];
  emailSubject?: string;
  /** REQ-1113: the email's words as plain text (same copy as its HTML). */
  emailText?: string;
  /** Only when a text will go (REQ-1113: never for an untextable phone). */
  smsBody?: string;
  /** REQ-1113: a phone is on file but no text will go, and why. */
  textSkip?: TextSkip;
  /** Why a send would reach nobody (same reasons as ReminderResult). */
  reason?: ReminderSkipReason;
}

export type ReminderChannel = "email" | "sms";
/** REQ-1113: "fictional" — a reserved 555 number the app knows can't take a
 *  text, so none is tried; "failed" — the text was tried and refused. */
export type TextSkip = "fictional" | "failed";

export interface ReminderResult {
  /** Invoice id we acted on. */
  invoiceId: string;
  /** Day step we fired (-3/0/3/7/14/30). */
  day: CadenceDay;
  /** Channels we successfully dispatched on. */
  channels: string[];
  /** True when the Day-30 escalation was used (notifies contractor only,
   *  does NOT dispatch to the customer). */
  escalated: boolean;
  /** REQ-556 (demo-loop cycle 4, M7): why nothing reached the customer, when
   *  nothing did — the reminders are muted, this rung already fired, there is
   *  no email or phone to send to, or every channel tried failed. */
  reason?: ReminderSkipReason;
  /** REQ-1113: a phone is on file but the text did not go, and why. */
  textSkip?: TextSkip;
}

export type ReminderSkipReason =
  | "muted"
  | "already_fired"
  | "no_recipient"
  | "not_delivered";

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
 *   - Day -3 / 0 (REQ-704, opt-in): text + email before / on the due date.
 *   - Day 3 / 7 / 14: text + email to customer.
 *   - Day 30: emit `invoice:escalated` for the contractor's bell only;
 *     no customer-facing dispatch (contractor decides whether to escalate
 *     manually).
 *   - Per-invoice mute: `remindersMuted=true` short-circuits the entire
 *     cadence for that invoice.
 *   - Business setting (REQ-623, demo cycle 4 M26): `BusinessIdentity.reminders`
 *     = { enabled, days } — off stops the sweep for every invoice; `days`
 *     picks which steps run. Unset → on, 3/7/14/30.
 *   - Eligibility: status in (sent|viewed) AND the step's day reached
 *     (dueDate − 3, the due date, or N days past it). A `claimed`
 *     invoice (the customer reported paying) is PAUSED — never dunned while
 *     the claim is pending; reject-claim flips it back to `sent`, which
 *     resumes the cadence where it left off (REQ-250, demo m12).
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
    /** REQ-784 — the business's outbox (defaulted for direct construction) */
    private commsLog: LogPaperworkMessage = new LogPaperworkMessage(
      new ConversationStore(),
      new MessageStore(),
    ),
  ) {}

  async runAll(userId: string, now: Date = new Date()): Promise<ReminderResult[]> {
    const out: ReminderResult[] = [];
    // REQ-623: the business's on/off switch and cadence days
    const settings = reminderSettingsOf(
      await this.identity.get(userId).catch(() => null),
    );
    if (!settings.enabled) return out;
    const all = await this.invoices.listByUser(userId);
    for (const inv of all) {
      const day = pickNextDay(inv, now, settings.days);
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
      return { invoiceId, day, channels: [], escalated: false, reason: "muted" };
    }
    if (alreadyFiredOn(invoice, day)) {
      return {
        invoiceId,
        day,
        channels: [],
        escalated: false,
        reason: "already_fired",
      };
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

    // Days -3 / 0 / 3 / 7 / 14: dispatch to customer.
    const {
      copy,
      toEmail,
      toPhone,
      textSkip: skipped,
      senderEmail,
      url,
      fromAlias,
      businessName,
      lang,
      customerName,
    } = await this.compose(userId, invoice, day, now);
    // REQ-784 (demo-loop dv1, d12): each reminder is a customer message —
    // the outbox lists it, sent or not and why, with what was sent.
    const toOutbox = (
      channel: "email" | "text",
      ok: boolean,
      what: {
        to: string;
        subject?: string;
        body?: string;
        reasonCode?: string;
        reason?: string;
      },
    ) =>
      this.commsLog.outbox({
        userId,
        channel,
        kind: "reminder",
        language: lang,
        ok,
        customerId: invoice.customerId,
        customerName,
        docId: invoice.id,
        docRef: docRef(invoice),
        ...what,
      });

    // REQ-556 (demo-loop cycle 4, M7): a channel counts only when the
    // provider took the message; nothing delivered says why, and does not
    // burn the rung (add a contact and the next nudge goes out).
    const channels: string[] = [];
    // REQ-1113: a phone that can't take texts is not a recipient — no doomed
    // text is tried; the reply says so (textSkip) so the toast can too.
    let textSkip: TextSkip | undefined = skipped;
    if (!toEmail && !toPhone) {
      return {
        invoiceId,
        day,
        channels,
        escalated: false,
        reason: skipped ? "not_delivered" : "no_recipient",
        ...(skipped ? { textSkip: skipped } : {}),
      };
    }
    if (toEmail) {
      try {
        const res = await this.email.send({
          to: toEmail,
          subject: copy.emailSubject,
          htmlBody: copy.emailHtml(url),
          // REQ-628: under the business's name, never DocuMonster
          from: businessFrom({ alias: fromAlias, name: businessName }),
          ...(senderEmail ? { cc: [senderEmail] } : {}),
        });
        if (res.ok) channels.push("email");
        else console.warn(`[send-payment-reminder] email not sent: ${res.reason}`);
        await toOutbox("email", res.ok, {
          to: toEmail,
          subject: copy.emailSubject,
          body: copy.emailHtml(url),
          ...(res.ok ? {} : { reason: res.reason }),
        });
      } catch (err) {
        console.error("[send-payment-reminder] email failed:", err);
        await toOutbox("email", false, {
          to: toEmail,
          subject: copy.emailSubject,
          reason: (err as Error)?.message ?? String(err),
        });
      }
    }
    if (toPhone) {
      try {
        const res = await this.sms.send({ to: toPhone, body: copy.smsBody(url) });
        if (res.ok) channels.push("sms");
        else {
          textSkip = "failed";
          console.warn(`[send-payment-reminder] sms not sent: ${res.detail ?? res.reason}`);
        }
        await toOutbox("text", res.ok, {
          to: toPhone,
          body: copy.smsBody(url),
          ...(res.ok ? {} : { reasonCode: res.failureCode, reason: res.reason }),
        });
      } catch (err) {
        console.error("[send-payment-reminder] sms failed:", err);
        textSkip = "failed";
        await toOutbox("text", false, {
          to: toPhone,
          reason: (err as Error)?.message ?? String(err),
        });
      }
    }
    if (channels.length === 0) {
      return {
        invoiceId,
        day,
        channels,
        escalated: false,
        reason: "not_delivered",
        ...(textSkip ? { textSkip } : {}),
      };
    }

    await this.appendHistory(userId, invoice, day, channels);
    return {
      invoiceId,
      day,
      channels,
      escalated: false,
      ...(textSkip ? { textSkip } : {}),
    };
  }

  /** REQ-704 (demo cycle 5, m60): the reminder `runForInvoice` would send for
   *  `day`, rendered — same copy, same recipients, same link — and sent to
   *  nobody. Day 30 says it only alerts the owner. */
  async preview(
    userId: string,
    invoiceId: string,
    day: CadenceDay,
    now: Date = new Date(),
  ): Promise<ReminderPreview> {
    const invoice = await this.invoices.getOwned(invoiceId, userId);
    const reason: ReminderSkipReason | undefined = invoice.remindersMuted
      ? "muted"
      : alreadyFiredOn(invoice, day)
      ? "already_fired"
      : undefined;
    if (day === 30) {
      return {
        invoiceId,
        day,
        escalated: true,
        channels: [],
        ...(reason ? { reason } : {}),
      };
    }
    const { copy, toEmail, toPhone, textSkip, phoneOnFile, url } = await this.compose(userId, invoice, day, now);
    // REQ-1113: the same recipients runForInvoice dispatches to, in its order
    const channels: ReminderChannel[] = [
      ...(toEmail ? ["email" as const] : []),
      ...(toPhone ? ["sms" as const] : []),
    ];
    const why = reason ??
      (channels.length > 0 ? undefined : textSkip ? "not_delivered" : "no_recipient");
    return {
      invoiceId,
      day,
      escalated: false,
      ...(toEmail ? { email: toEmail } : {}),
      ...(phoneOnFile ? { phone: phoneOnFile } : {}),
      channels,
      ...(toEmail ? { emailSubject: copy.emailSubject, emailText: copy.emailText(url) } : {}),
      ...(toPhone ? { smsBody: copy.smsBody(url) } : {}),
      ...(textSkip ? { textSkip } : {}),
      ...(why ? { reason: why } : {}),
    };
  }

  /** The customer-facing copy, recipients and invoice link for one step. */
  private async compose(userId: string, invoice: Invoice, day: CadenceDay, now?: Date) {
    const [customer, sender, biz] = await Promise.all([
      invoice.customerId
        ? this.customers.getOwned(invoice.customerId, userId).catch(() => undefined)
        : Promise.resolve(undefined),
      this.users.get(userId).catch(() => undefined),
      this.identity.get(userId).catch(() => null),
    ]);
    // REQ-715 (demo-loop cycle 5, m31): the reminder speaks the customer's
    // own language, else the business's send default, else en.
    const lang = resolveCommsLanguage({
      customerLanguage: customer?.language,
      identityCommsLanguage: biz?.commsLanguage,
      sendLanguages: biz?.commsLanguages, // REQ-925
    });
    // REQ-628: never DocuMonster — the business, else the sender, else a neutral word
    const businessName = biz?.businessName?.trim() || biz?.legalName?.trim() || sender?.name?.trim() || t(lang, "paymentReminder.senderFallback");
    // REQ-204: the reminder greets the customer as snapshotted on the bill
    const shown = customerOnDocument(invoice, customer);
    const customerFirst = (shown?.name ?? shown?.businessName)?.trim().split(/\s+/)[0];
    const senderFirst = sender?.name?.trim().split(/\s+/)[0];
    const appUrl = Deno.env.get("APP_URL") ?? SITE_ORIGIN;
    // REQ-628: headed by the business's own logo, or its name as a wordmark
    const logoHtml = emailLogoHtml(emailLogo({ appUrl, kind: "invoice", id: invoice.id, biz, fallbackName: businessName }));
    const copy = composeReminderCopy({ day, customerFirst, senderFirst, businessName, invoice, lang, logoHtml, now });

    // Mint a shortlink to the public invoice page for the SMS + email CTA.
    let url = "";
    try {
      const link = await this.shortlinks.findOrCreate(userId, "invoice", invoice.id);
      // REQ-715 (REQ-342 parity): the link opens the invoice in the
      // reminder's language
      url = withSendLang(`${appUrl}/s/${link.code}`, lang);
    } catch { /* fall through */ }

    const toEmail = customer?.email || shown?.email || undefined;
    const phoneOnFile = customer?.phoneNumber || shown?.phoneNumber || undefined;
    // REQ-1113 (REQ-569's one rule): a reserved 555 number can't take a text —
    // it is not a text recipient, in the preview or the send.
    const textSkip: TextSkip | undefined = phoneCantReceiveTexts(phoneOnFile) ? "fictional" : undefined;
    const toPhone = textSkip ? undefined : phoneOnFile;
    return {
      copy,
      toEmail,
      toPhone,
      phoneOnFile,
      textSkip,
      senderEmail: sender?.email,
      url,
      businessName,
      fromAlias: biz?.emailAlias,
      // REQ-784: what the outbox entry says
      lang,
      customerName: customerLabel(shown),
    };
  }

  private async appendHistory(userId: string, invoice: Invoice, day: CadenceDay, channels: string[]): Promise<void> {
    const next = [...(invoice.reminderHistory ?? []), { day, sentAt: new Date().toISOString(), channels }];
    await this.invoices.update(invoice.id, userId, { reminderHistory: next });
  }
}

/** Pick the next eligible day to fire for `invoice`. Returns undefined
 *  if nothing's due (muted, paid, void, scheduled, draft, claimed — the
 *  customer said they paid, REQ-250 — or within the
 *  past-due window of the next step but hasn't crossed it yet).
 *
 *  Cadence semantics:
 *    - Pick the LARGEST elapsed step that hasn't fired yet (so a
 *      contractor adopting the system mid-cycle on a 30-day-late
 *      invoice goes straight to Day 30 rather than the gentle Day-3
 *      copy).
 *    - Never regress: once customer Day N has fired, no step < N will fire.
 *      The Day-30 owner alert (bell-only, REQ-704) does not count — it
 *      reached nobody, so it never stops the 3/7/14 customer steps (REQ-938).
 */
/** REQ-250 (demo m12): `claimed` is deliberately absent — a pending payment
 *  claim pauses the cadence. */
const REMINDER_ELIGIBLE: readonly string[] = ["sent", "viewed"];

export function pickNextDay(
  invoice: Invoice,
  now: Date,
  /** REQ-623: the business's cadence (BusinessIdentity.reminders.days) */
  days: readonly CadenceDay[] = DEFAULT_REMINDER_DAYS,
): CadenceDay | undefined {
  if (invoice.remindersMuted) return undefined;
  if (!REMINDER_ELIGIBLE.includes(invoice.status ?? "")) return undefined;
  if (!invoice.dueDate) return undefined;
  const cadence = CADENCE_DAYS.filter((d) => days.includes(d));
  if (cadence.length === 0) return undefined;
  if (!stepReached(invoice, now, cadence[0])) return undefined;
  const firedDays = new Set((invoice.reminderHistory ?? []).map((h) => h.day));
  let largestFired: number | undefined;
  for (const d of CADENCE_DAYS) {
    if (d !== 30 && firedDays.has(d)) largestFired = d;
  }
  for (let i = cadence.length - 1; i >= 0; i--) {
    const d = cadence[i];
    if (!stepReached(invoice, now, d)) continue;
    if (firedDays.has(d)) continue;
    if (largestFired != null && d < largestFired) continue;
    return d;
  }
  return undefined;
}

/** Has the clock reached step `day`? Post-due steps count whole days past the
 *  end of the due date (unchanged since REQ-021); the before-due / due-date
 *  steps (REQ-704) count calendar days from it — -3 is three days before,
 *  0 is the due date itself. */
function stepReached(invoice: Invoice, now: Date, day: CadenceDay): boolean {
  if (day > 0) return daysOverdue(invoice, now) >= day;
  const d = daysFromDue(invoice.dueDate, now.toISOString().slice(0, 10));
  return d != null && d >= day;
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
  lang?: "en" | "es";
  /** REQ-628: the business's logo (or wordmark) heading the email */
  logoHtml?: string;
  /** REQ-1115: when the reminder goes out. The before-due wording follows
   *  the days actually left, not the step number — a manual nudge before the
   *  due date is always step -3 (`manualReminderDay`). */
  now?: Date;
}): {
  emailSubject: string;
  emailHtml: (url: string) => string;
  /** REQ-1113: the email's words as plain text, for the preview (its
   *  body; the invoice ref it is headed by is in the subject) */
  emailText: (url: string) => string;
  smsBody: (url: string) => string;
} {
  const { day, customerFirst, senderFirst, businessName, invoice } = opts;
  const lang = opts.lang === "es" ? "es" : "en";
  const hi = customerFirst ? t(lang, "paymentReminder.greeting", { name: customerFirst }) : "";
  const sender = senderFirst ?? t(lang, "paymentReminder.senderFallback");
  // REQ-1028 (LOOP-007 q2-9): a reminder asks for what is still owed — the
  // open balance once part is paid, never the full total again.
  const open = invoice.status === "paid" || invoice.paidAt
    ? (invoice.amount ?? 0)
    : invoiceBalance(invoice.amount, invoice.paidCents).balanceCents;
  const amount = formatUsdCents(open); // REQ-1109: "$1,035.50", never "$1,035.5"
  // REQ-1115 (LOOP-007 q3-39): "due soon" is the REQ-704 copy for three
  // days out. A step -3 reminder sent earlier than that (the Remind button
  // a month ahead) names the due date instead.
  const daysLeft = opts.now ? daysFromDue(invoice.dueDate, opts.now.toISOString().slice(0, 10)) : null;
  const upcoming = day < 0 && daysLeft != null && daysLeft < -3;
  const dueDateText = formatLongDate(invoice.dueDate, lang);
  const tone = upcoming
    ? t(lang, "paymentReminder.tone.upcoming", { businessName, dueDate: dueDateText })
    : day < 0
    ? t(lang, "paymentReminder.tone.beforeDue", { businessName })
    : day === 0
    ? t(lang, "paymentReminder.tone.dueToday", { businessName })
    : day === 3
    ? t(lang, "paymentReminder.tone.day3", { businessName })
    : day === 7
    ? t(lang, "paymentReminder.tone.day7", { businessName })
    : t(lang, "paymentReminder.tone.day14", { businessName });
  // REQ-1111 (LOOP-007 q3, q3-36): the due date reads in the long form every
  // other paperwork email uses ("November 19, 2026" / "19 de noviembre de
  // 2026"), never the stored ISO "2026-11-19".
  const dueLine = invoice.dueDate
    ? t(lang, "paymentReminder.dueSuffix", { dueDate: fmtPaperworkDate(invoice.dueDate, lang) })
    : "";
  // REQ-204 / REQ-201: every reminder names the bill — "INV-5000 · Version 2"
  const ref = docRef(invoice);
  const refVersion = docRefWithVersion(invoice, lang);
  const subjectBase = upcoming
    ? t(lang, "paymentReminder.subject.upcoming", { businessName })
    : day < 0
    ? t(lang, "paymentReminder.subject.beforeDue", { businessName })
    : day === 0
    ? t(lang, "paymentReminder.subject.dueToday", { businessName })
    : day === 3
    ? t(lang, "paymentReminder.subject.day3", { businessName })
    : day === 7
    ? t(lang, "paymentReminder.subject.day7", { businessName })
    : t(lang, "paymentReminder.subject.day14", { sender });
  return {
    emailSubject: `${subjectBase} · ${ref}`,
    emailHtml: (url: string) => `${emailRoot(lang)}<body style="margin:0;padding:32px 16px;background:#f7f6f1;font-family:-apple-system,sans-serif;color:#1c2c30">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:28px 32px">
    ${opts.logoHtml ? `<div style="margin:0 0 16px">${opts.logoHtml}</div>` : ""}
    <div data-doc-ref style="margin:0 0 12px;font-size:12px;font-weight:800;color:#6b7a7e">${docTitle("invoice", invoice, lang)}</div>
    <p style="margin:0;font-size:15px;line-height:1.55">${hi}${tone}</p>
    <p style="margin:14px 0 0;font-size:15px"><strong>${t(lang, "paymentReminder.amountDueLabel")}</strong> ${amount}${dueLine}</p>
    ${url ? `<p style="margin:18px 0 0"><a href="${url}" style="display:inline-block;background:#519843;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">${t(lang, "paymentReminder.openInvoiceCta")}</a></p>` : ""}
    <p style="margin:18px 0 0;font-size:13px;color:#6b7a7e">${sender}</p>
  </div>
</body></html>`,
    emailText: (url: string) =>
      [
        `${hi}${tone}`,
        `${t(lang, "paymentReminder.amountDueLabel")} ${amount}${dueLine}`,
        ...(url ? [`${t(lang, "paymentReminder.openInvoiceCta")}: ${url}`] : []),
        sender,
      ].join("\n\n"),
    smsBody: (url: string) =>
      `${hi}${tone} ${amount} (${refVersion})${url ? ` — ${url}` : ""}${senderFirst ? ` — ${senderFirst}` : ""}`,
  };
}
