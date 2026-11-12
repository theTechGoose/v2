import { assertEquals } from "#std/assert";
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

/**
 * REQ-250 — demo issue quote-invoice-money-m12 (Pair 9): "a payment reminder
 * can be sent after the client reported paying, with no warning".
 *
 * The automatic day-3/7/14/30 sweep (`runAll`, behind the overdue cron) kept
 * dunning a customer whose invoice was `claimed` ("I paid by Zelle, ref
 * ZL-88412"). While a claim is pending the cadence is paused; rejecting the
 * claim (status back to `sent`) resumes it.
 */

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
  return { invoices, customers, users, reminders, emails, texts };
}

Deno.test("REQ-250 m12: the overdue sweep sends nothing on a claimed invoice, and resumes once the claim is rejected", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const contractor = await ctx.users.create({ phoneNumber: "+15125557250" });
  const customer = await ctx.customers.create(contractor.id, {
    name: "Juan Pérez",
    email: "juan@example.com",
    phoneNumber: "+15125557251",
  });
  const inv = await ctx.invoices.create(contractor.id, {
    customerId: customer.id,
    amount: 480_00,
    dueDate: "2026-05-01",
    status: "claimed",
    paymentIntent: {
      method: "zelle",
      reference: "ZL-88412",
      claimedAt: "2026-05-02T10:00:00Z",
      claimedBy: "Juan",
    },
  } as never);
  const fivePast = new Date("2026-05-06T12:00:00Z");

  const paused = await ctx.reminders.runAll(contractor.id, fivePast);
  assertEquals(paused, [], "no rung fires while the claim is pending");
  assertEquals(ctx.emails.length, 0);
  assertEquals(ctx.texts.length, 0);
  assertEquals(
    (await ctx.invoices.getOwned(inv.id, contractor.id)).reminderHistory ?? [],
    [],
  );

  // "Didn't get it" — the controller's reject-claim patch.
  await ctx.invoices.update(inv.id, contractor.id, {
    status: "sent",
    paymentIntent: null,
  } as never);
  const resumed = await ctx.reminders.runAll(contractor.id, fivePast);
  assertEquals(resumed.map((r) => r.day), [3]);
  assertEquals(ctx.emails.length, 1);
  assertEquals(ctx.texts.length, 1);
});
