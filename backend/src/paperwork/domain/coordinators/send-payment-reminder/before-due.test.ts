/**
 * REQ-704 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue m60: "Reminders: no
 * before-due option, no preview, wording disagrees with Settings".
 *
 * The cadence was post-due only (CADENCE_DAYS = [3, 7, 14, 30]). It now also
 * offers -3 (three days before the due date) and 0 (on the due date), each
 * with its own copy, and `preview()` renders exactly what a nudge would send
 * without sending it.
 */
import { assertEquals, assertStringIncludes } from "#std/assert";
import {
  CADENCE_DAYS,
  composeReminderCopy,
  pickNextDay,
  SendPaymentReminder,
} from "./mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
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

function inv(overrides: Partial<Invoice>): Invoice {
  return {
    id: "i-1",
    userId: "u-1",
    quoteId: "q-1",
    dueDate: "2026-05-10",
    amount: 100_00,
    status: "sent",
    createdAt: "2026-04-25T00:00:00Z",
    updatedAt: "2026-04-25T00:00:00Z",
    ...overrides,
  };
}

const ALL = [-3, 0, 3, 7, 14, 30] as const;

Deno.test("REQ-704 m60: the cadence offers 3 days before due (-3) and the due date (0)", () => {
  assertEquals([...CADENCE_DAYS], [...ALL]);
});

Deno.test("REQ-704 m60 pickNextDay: -3 fires three days before the due date, 0 on it, then the post-due steps", () => {
  const fired = (...days: number[]) =>
    days.map((day) => ({ day, sentAt: "2026-05-01T00:00:00Z", channels: ["email"] }));
  // five days before due → nothing yet
  assertEquals(pickNextDay(inv({}), new Date("2026-05-05T12:00:00Z"), ALL), undefined);
  // three days before due → -3
  assertEquals(pickNextDay(inv({}), new Date("2026-05-07T12:00:00Z"), ALL), -3);
  // the due date itself → 0
  assertEquals(
    pickNextDay(inv({ reminderHistory: fired(-3) }), new Date("2026-05-10T09:00:00Z"), ALL),
    0,
  );
  // after both → day 3 once it is 3 days late (the existing rule)
  assertEquals(
    pickNextDay(inv({ reminderHistory: fired(-3, 0) }), new Date("2026-05-14T12:00:00Z"), ALL),
    3,
  );
  // the default cadence (unset) never fires before due
  assertEquals(pickNextDay(inv({}), new Date("2026-05-08T12:00:00Z")), undefined);
  assertEquals(pickNextDay(inv({}), new Date("2026-05-10T12:00:00Z")), undefined);
  // no due date → nothing, ever
  assertEquals(
    pickNextDay(inv({ dueDate: undefined }), new Date("2026-05-10T12:00:00Z"), ALL),
    undefined,
  );
});

Deno.test("REQ-704 m60 composeReminderCopy: before-due and due-today copy, never the 'still open' overdue copy", () => {
  const base = {
    customerFirst: "Ana",
    senderFirst: "Raphael",
    businessName: "Raph Roofing",
    invoice: inv({}),
  };
  const before = composeReminderCopy({ ...base, day: -3 });
  assertStringIncludes(before.smsBody(""), "is due soon");
  assertStringIncludes(before.emailSubject, "Coming up: invoice from Raph Roofing");
  const today = composeReminderCopy({ ...base, day: 0, lang: "es" });
  assertStringIncludes(today.smsBody(""), "vence hoy");
  assertStringIncludes(today.emailSubject, "Vence hoy: factura de Raph Roofing");
});

function fresh() {
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
  const identity = new BusinessIdentityStore();
  const reminders = new SendPaymentReminder(
    invoices,
    customers,
    users,
    identity,
    email,
    sms,
    new ShortLinkStore(),
    new EventBus(),
  );
  return { invoices, customers, users, identity, reminders, emails, texts };
}

Deno.test("REQ-704 m60: a business that picks 'before due' gets a reminder sent 3 days before the due date", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const contractor = await ctx.users.create({ phoneNumber: "+15125557704" });
  const customer = await ctx.customers.create(contractor.id, {
    name: "Ana Ruiz",
    email: "ana@example.com",
  });
  await ctx.invoices.create(contractor.id, {
    customerId: customer.id,
    amount: 250_00,
    dueDate: "2026-05-10",
    status: "sent",
  } as never);
  await ctx.identity.upsert(contractor.id, {
    reminders: { enabled: true, days: [-3, 0, 3, 7, 14, 30] },
  } as never);
  const fired = await ctx.reminders.runAll(contractor.id, new Date("2026-05-07T12:00:00Z"));
  assertEquals(fired.map((r) => [r.day, r.channels]), [[-3, ["email"]]]);
  assertStringIncludes(ctx.emails[0].subject, "Coming up");
});

Deno.test("REQ-704 m60 preview: renders the exact text a nudge sends, sends nothing, and says day 30 only alerts the owner", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const contractor = await ctx.users.create({ phoneNumber: "+15125557705" });
  const customer = await ctx.customers.create(contractor.id, {
    name: "Ana Ruiz",
    email: "ana@example.com",
    phoneNumber: "+15125557706",
  });
  const invoice = await ctx.invoices.create(contractor.id, {
    customerId: customer.id,
    amount: 250_00,
    dueDate: "2026-05-01",
    status: "sent",
  } as never);
  const now = new Date("2026-05-09T12:00:00Z");

  const p = await ctx.reminders.preview(contractor.id, invoice.id, 7, now);
  assertEquals(p.escalated, false);
  assertEquals(p.email, "ana@example.com");
  assertEquals(p.phone, "+15125557706");
  assertStringIncludes(p.smsBody ?? "", "Hi Ana");
  assertEquals(ctx.emails.length + ctx.texts.length, 0, "a preview sends nothing");
  const after = await ctx.invoices.getOwned(invoice.id, contractor.id);
  assertEquals(after.reminderHistory ?? [], [], "a preview burns no rung");

  const sent = await ctx.reminders.runForInvoice(contractor.id, invoice.id, 7, now);
  assertEquals(sent.channels, ["email", "sms"]);
  assertEquals(ctx.texts[0].body, p.smsBody, "the preview is what was sent");
  assertEquals(ctx.emails[0].subject, p.emailSubject);

  const alert = await ctx.reminders.preview(contractor.id, invoice.id, 30, now);
  assertEquals(alert.escalated, true);
  assertEquals(alert.smsBody, undefined);
});
