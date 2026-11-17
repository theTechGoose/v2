/**
 * REQ-556 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue M7 (pair 10): "Send a nudge" on an invoice
 * with no recipient said "Already nudged today — the next reminder is
 * scheduled." runForInvoice dispatched nothing and answered `channels: []`,
 * the same answer as a muted invoice or a rung already fired — and it counted
 * a channel as used whatever the provider answered.
 *
 * runForInvoice now says WHY nothing went out (`reason`: "muted" |
 * "already_fired" | "no_recipient" | "not_delivered"), lists only channels
 * that delivered, and does not burn the rung when nothing was delivered (so
 * adding a contact and nudging again works).
 */
import { assertEquals } from "#std/assert";
import { SendPaymentReminder } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailResult,
} from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

/** SMS: the real guarded service in dev mode (no TWILIO_ACCOUNT_SID) */
function rig(emailAnswer: SendEmailResult = { ok: true }) {
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const email = new EmailService();
  email.send = () => Promise.resolve(emailAnswer);
  const reminders = new SendPaymentReminder(
    invoices,
    customers,
    new UserStore(),
    new BusinessIdentityStore(),
    email,
    new SmsService(),
    new ShortLinkStore(),
    new EventBus(),
  );
  return { invoices, customers, reminders };
}

async function overdueFor(
  r: ReturnType<typeof rig>,
  customer?: { name: string; phoneNumber?: string; email?: string },
  extra: Record<string, unknown> = {},
) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const c = customer ? await r.customers.create("u-556", customer) : undefined;
  return await r.invoices.create(
    "u-556",
    {
      ...(c ? { customerId: c.id } : {}),
      amount: 300_00,
      status: "sent",
      dueDate: "2026-11-01",
      ...extra,
    } as unknown as Parameters<InvoiceStore["create"]>[1],
  );
}

const NOW = new Date("2026-11-12T12:00:00Z");

Deno.test("REQ-556 (M7) nudge: an invoice with no customer (pair 10) → reason 'no_recipient', no channel, the rung is not burned", async () => {
  const r = rig();
  try {
    const inv = await overdueFor(r);
    const out = await r.reminders.runForInvoice("u-556", inv.id, 14, NOW);
    assertEquals(out.channels, []);
    assertEquals(out.reason, "no_recipient");
    assertEquals((await r.invoices.get(inv.id)).reminderHistory ?? [], []);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-556 (M7) nudge: the email failed and the number is fictional → reason 'not_delivered', no channel listed", async () => {
  const r = rig({ ok: false, reason: "bounced" });
  try {
    const inv = await overdueFor(r, {
      name: "Mrs Garcia",
      email: "g@example.com",
      phoneNumber: "5125550142",
    });
    const out = await r.reminders.runForInvoice("u-556", inv.id, 14, NOW);
    assertEquals(out.channels, []);
    assertEquals(out.reason, "not_delivered");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-556 (M7) nudge: muted → reason 'muted'; a rung already fired → reason 'already_fired'", async () => {
  const r = rig();
  try {
    const muted = await overdueFor(r, { name: "M", email: "m@example.com" }, {
      remindersMuted: true,
    });
    assertEquals(
      (await r.reminders.runForInvoice("u-556", muted.id, 14, NOW)).reason,
      "muted",
    );
    const fired = await overdueFor(r, { name: "F", email: "f@example.com" });
    const first = await r.reminders.runForInvoice("u-556", fired.id, 14, NOW);
    assertEquals(first.channels, ["email"]);
    assertEquals(first.reason, undefined);
    const again = await r.reminders.runForInvoice("u-556", fired.id, 14, NOW);
    assertEquals(again.channels, []);
    assertEquals(again.reason, "already_fired");
  } finally {
    await resetKv();
  }
});
