/**
 * REQ-938 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green." LOOP-007 cycle 1, issue q1-14:
 * "Overdue nudge and reminder send nothing for an invoice issued already past
 * due".
 *
 * The card's "Send nudge" posts `{ day: manualReminderDay(dueDate, today) }`
 * to /cron/invoice-reminder → `runForInvoice`. For an invoice 18 days past
 * due that day is 30: bell-only, nothing to the customer, and the day-30 row
 * in the history stops the daily sweep from ever sending day 14.
 */
import { assert, assertEquals } from "#std/assert";
import { pickNextDay, SendPaymentReminder } from "./mod.ts";
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

const DUE = "2026-11-01";
const TODAY = "2026-11-19";
const NOW = new Date(`${TODAY}T12:00:00Z`);

async function rig() {
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
  const owner = await users.create({ phoneNumber: "+15125559381" });
  const customer = await customers.create(owner.id, {
    name: "Dana Ruiz",
    email: "dana@example.com",
  });
  // issued today with a due date already 18 days gone (INV-002)
  const inv = await invoices.create(owner.id, {
    customerId: customer.id,
    amount: 640_00,
    status: "sent",
    issuedDate: TODAY,
    dueDate: DUE,
  } as never);
  return { invoices, reminders, emails, texts, owner, inv };
}

Deno.test("REQ-938 (LOOP-007 q1-14): Send nudge on an invoice 18 days past due reaches the customer", async () => {
  const r = await rig();
  try {
    // the day the card / drawer posts (InvoicesPage doSendNudge)
    const day = manualReminderDay(DUE, TODAY);
    const out = await r.reminders.runForInvoice(r.owner.id, r.inv.id, day, NOW);
    assert(
      out.channels.length > 0,
      `the nudge reached the customer (day ${day}, ${JSON.stringify(out)})`,
    );
    assertEquals(
      r.emails.map((e) => e.to),
      ["dana@example.com"],
      "one reminder email to the customer",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-938 (LOOP-007 q1-14): after Send nudge the customer gets a reminder — the nudge or the sweep, never neither", async () => {
  const r = await rig();
  try {
    const day = manualReminderDay(DUE, TODAY);
    await r.reminders.runForInvoice(r.owner.id, r.inv.id, day, NOW);
    await r.reminders.runAll(r.owner.id, NOW);
    assert(
      r.emails.length + r.texts.length > 0,
      `a reminder reached the customer (history ${
        JSON.stringify((await r.invoices.get(r.inv.id)).reminderHistory)
      })`,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-938 (LOOP-007 q1-14): a recorded day-30 owner alert never stops the day-14 customer step", async () => {
  const r = await rig();
  try {
    assertEquals(
      pickNextDay(await r.invoices.get(r.inv.id), NOW),
      14,
      "before: the sweep sends day 14",
    );
    const alert = await r.reminders.runForInvoice(r.owner.id, r.inv.id, 30, NOW);
    assertEquals(alert.escalated, true);
    assertEquals(
      pickNextDay(await r.invoices.get(r.inv.id), NOW),
      14,
      "after the bell-only day 30: the sweep still sends day 14",
    );
  } finally {
    await resetKv();
  }
});

// REQ-1111 (LOOP-007 cycle 3, q3-36): the nudge email names the due date in
// the long form every other paperwork email uses, never the stored ISO.
const LONG_DUE = { en: "November 1, 2026", es: "1 de noviembre de 2026" } as const;
for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1111 (LOOP-007 q3, q3-36): the ${lang} Send nudge email reads the due date "${LONG_DUE[lang]}", never ${DUE}`, async () => {
    const r = await rig();
    try {
      const customers = new CustomerStore();
      const reader = await customers.create(r.owner.id, {
        name: lang === "es" ? "Carmen Ortega" : "Dana Ruiz",
        email: `reader-${lang}@example.com`,
        language: lang,
      } as never);
      const inv = await r.invoices.create(r.owner.id, {
        customerId: reader.id,
        amount: 225_30,
        status: "sent",
        issuedDate: "2026-10-02",
        dueDate: DUE,
      } as never);
      const day = manualReminderDay(DUE, TODAY);
      await r.reminders.runForInvoice(r.owner.id, inv.id, day, NOW);
      const mail = r.emails.find((e) => e.to === `reader-${lang}@example.com`);
      assert(mail, `the nudge emailed her (${JSON.stringify(r.emails.map((e) => e.to))})`);
      // the CTA href may carry anything; read the visible text only
      const text = mail.htmlBody.replace(/href="[^"]*"/g, "").replace(/<[^>]+>/g, " ");
      const dueLine = text.match(/(?:Due|Vence)[^\n]*?(?=\s{2,}|$)/)?.[0] ?? "(no due line)";
      assert(
        !/\d{4}-\d{2}-\d{2}/.test(text),
        `the ${lang} nudge email prints a raw ISO date: "${dueLine.trim()}"`,
      );
      assert(
        text.includes(LONG_DUE[lang]),
        `the ${lang} nudge email never names "${LONG_DUE[lang]}" (got "${dueLine.trim()}")`,
      );
    } finally {
      await resetKv();
    }
  });
}
