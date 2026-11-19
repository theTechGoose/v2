/**
 * REQ-1115 — Raphael (LOOP-007): "test every single aspect of this
 * application … one Opus agent per issue to do root cause analysis, then one
 * to write the test, then one to fix it and make it green." Cycle 3, issue
 * q3-39: "Reminder says 'vence pronto' for a bill due in 30 days".
 *
 * Through the real path the Remind button takes: the day it posts
 * (`manualReminderDay(dueDate, today)` → -3 for any date before due) into
 * `SendPaymentReminder.runForInvoice`, with real stores on KV :memory:, for a
 * Spanish-reading customer whose invoice is due in 30 days. The email that
 * goes out must not say "vence pronto" nor carry the "Próximo vencimiento"
 * subject — those are the three-days-out sweep copy (REQ-704).
 */
import { assert, assertEquals } from "#std/assert";
import { SendPaymentReminder } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { manualReminderDay } from "#quote-flow/reminder-settings.ts";

async function rig(dueDate: string, today: string) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const users = new UserStore();
  const email = new EmailService();
  const emails: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    emails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const sms = new SmsService();
  const texts: SendSmsInput[] = [];
  sms.send = (input: SendSmsInput) => {
    texts.push(input);
    return Promise.resolve({ ok: true });
  };
  const reminders = new SendPaymentReminder(
    invoices,
    customers,
    users,
    new BusinessIdentityStore(),
    email,
    sms,
    new ShortLinkStore(),
    new EventBus(),
  );
  const owner = await users.create({ phoneNumber: "+15125551115" });
  const customer = await customers.create(owner.id, {
    name: "Lucía Ortiz",
    email: "lucia@example.com",
    language: "es",
  } as never);
  const inv = await invoices.create(owner.id, {
    customerId: customer.id,
    amount: 820_67,
    status: "sent",
    issuedDate: today,
    dueDate,
  } as never);
  return { reminders, emails, texts, owner, inv };
}

Deno.test("REQ-1115 (LOOP-007 q3-39): Remind on a Spanish invoice due in 30 days emails no 'vence pronto' and no 'Próximo vencimiento' subject", async () => {
  const DUE = "2026-12-19";
  const TODAY = "2026-11-19";
  const r = await rig(DUE, TODAY);
  try {
    const day = manualReminderDay(DUE, TODAY);
    const out = await r.reminders.runForInvoice(r.owner.id, r.inv.id, day, new Date(`${TODAY}T15:00:00Z`));
    assertEquals(out.channels, ["email"], `the reminder went by email (${JSON.stringify(out)})`);
    const mail = r.emails[0];
    const tone = mail.htmlBody.match(/<p style="margin:0;font-size:15px;line-height:1.55">([^<]*)<\/p>/)?.[1] ?? "";
    assert(tone.startsWith("Hola"), `the reminder is in Spanish (got "${tone}")`);
    assert(!/vence pronto/i.test(mail.htmlBody), `30 days out the email says "${tone}"`);
    assert(!/Próximo vencimiento/i.test(mail.subject), `30 days out the subject is "${mail.subject}"`);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1115 (LOOP-007 q3-39): Remind three days before the due date still says 'vence pronto' (REQ-704 copy kept)", async () => {
  const DUE = "2026-12-19";
  const TODAY = "2026-12-16";
  const r = await rig(DUE, TODAY);
  try {
    const day = manualReminderDay(DUE, TODAY);
    await r.reminders.runForInvoice(r.owner.id, r.inv.id, day, new Date(`${TODAY}T15:00:00Z`));
    assert(/vence pronto/i.test(r.emails[0]?.htmlBody ?? ""), "three days out the email says 'vence pronto'");
    assert(/Próximo vencimiento/i.test(r.emails[0]?.subject ?? ""), `subject: ${r.emails[0]?.subject}`);
  } finally {
    await resetKv();
  }
});
