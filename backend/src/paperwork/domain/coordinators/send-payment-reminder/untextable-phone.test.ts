/**
 * REQ-1113 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green." LOOP-007 cycle 3, issue
 * q3-38: "Remind dialog previews a text, but only an email with different
 * wording goes".
 *
 * A customer with an email and a reserved 555-01XX phone (843-555-0142):
 * the app knows ahead of time the phone can't take a text
 * (shared/quote-flow/sms-number.ts phoneCantReceiveTexts). The preview must
 * say only the email goes — channels ["email"], the email's subject and
 * body, no smsBody, textSkip "fictional" — and runForInvoice must agree with
 * it: no doomed sms.send, and a reply that says the text was skipped.
 */
import { assert, assertEquals } from "#std/assert";
import { SendPaymentReminder } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const RESERVED = "843-555-0142";
const NOW = new Date("2026-11-12T12:00:00Z");

function rig() {
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const email = new EmailService();
  const emailed: { subject: string; htmlBody: string }[] = [];
  email.send = (m) => {
    emailed.push({ subject: m.subject, htmlBody: m.htmlBody ?? "" });
    return Promise.resolve({ ok: true });
  };
  const sms = new SmsService();
  const texted: string[] = [];
  const realSend = sms.send.bind(sms);
  sms.send = (m) => {
    texted.push(m.to);
    return realSend(m);
  };
  const reminders = new SendPaymentReminder(
    invoices,
    customers,
    new UserStore(),
    new BusinessIdentityStore(),
    email,
    sms,
    new ShortLinkStore(),
    new EventBus(),
  );
  return { invoices, customers, reminders, emailed, texted };
}

async function overdueFor(r: ReturnType<typeof rig>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const c = await r.customers.create("u-1113", {
    name: "Lucía Gómez",
    email: "lucia@blackhole.postmarkapp.com",
    phoneNumber: RESERVED,
  });
  return await r.invoices.create(
    "u-1113",
    {
      customerId: c.id,
      amount: 820_67,
      status: "sent",
      dueDate: "2026-11-01",
    } as unknown as Parameters<InvoiceStore["create"]>[1],
  );
}

Deno.test("REQ-1113 (LOOP-007 q3-38): preview for a customer with an email + a reserved 555-01XX phone names only the email channel and shows the email, not a text", async () => {
  const r = rig();
  try {
    const inv = await overdueFor(r);
    const pv = await r.reminders.preview("u-1113", inv.id, 14, NOW) as
      & Awaited<ReturnType<SendPaymentReminder["preview"]>>
      & { channels?: string[]; emailText?: string; textSkip?: string };
    assertEquals(
      pv.channels,
      ["email"],
      `preview must say only email goes (got ${JSON.stringify(pv)})`,
    );
    assertEquals(
      pv.smsBody,
      undefined,
      "no text body is previewed for a phone that can't take texts",
    );
    assertEquals(pv.textSkip, "fictional", "the preview says why no text goes");
    assert(pv.emailSubject, "the email's subject is previewed");
    assert(
      typeof pv.emailText === "string" && pv.emailText.length > 0,
      `the email's body is previewed (got ${JSON.stringify(pv.emailText)})`,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1113 (LOOP-007 q3-38): runForInvoice never attempts the doomed text to a reserved 555-01XX phone, and its reply agrees with the preview", async () => {
  const r = rig();
  try {
    const inv = await overdueFor(r);
    const out = await r.reminders.runForInvoice("u-1113", inv.id, 14, NOW) as
      & Awaited<ReturnType<SendPaymentReminder["runForInvoice"]>>
      & { textSkip?: string };
    assertEquals(out.channels, ["email"]);
    assertEquals(r.emailed.length, 1, "the email went");
    assertEquals(
      r.texted,
      [],
      `no sms.send for a number the app already knows can't take texts (tried ${
        JSON.stringify(r.texted)
      })`,
    );
    assertEquals(
      out.textSkip,
      "fictional",
      `the reply says the text was skipped, so the toast can say "email only" (got ${
        JSON.stringify(out)
      })`,
    );
  } finally {
    await resetKv();
  }
});
