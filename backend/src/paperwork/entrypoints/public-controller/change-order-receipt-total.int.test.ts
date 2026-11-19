/**
 * REQ-1055 — LOOP-007 cycle 2, issue q2-39. Raphael: "test every single
 * aspect of this application … one Opus agent per issue to do root cause
 * analysis, then one to write the test, then one to fix it and make it
 * green."
 *
 * After the customer approves a change order, /co heads it with the JOB's
 * new total (GET /change-orders/:id/public → jobNewAmount, REQ-398 m25) while
 * the receipt email named only the linked invoice's new total ("Your new
 * invoice total"). On a deposit + balance job the two always differ, and
 * the customer saw two "new totals" with nothing tying them together.
 *
 * The run: an $8,400 quote, a 30% deposit INV-001 $2,520 (paid) and the
 * balance INV-002 $5,880 (sent), CO-001 +$2,800 on INV-002. Approve over
 * HTTP; the receipt must carry the job total /co shows ($11,200.00) next to
 * a job-total label, and INV-002's $8,680.00.
 *
 * Integration over HTTP with the app booted (KV :memory:), transports
 * captured at their prototype like decision-alerts.int.test.ts.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule, CommunicationModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;
const J = { "content-type": "application/json" };

const CONTRACTOR_PHONE = "+15125559491";
const CUSTOMER_PHONE = "+15125559492";
const CUSTOMER_EMAIL = "maria.nguyen@example.com";

const emails: SendEmailInput[] = [];
const texts: SendSmsInput[] = [];
const digitsOf = (s: string) => s.replace(/\D/g, "").slice(-10);
const plain = (html = "") =>
  html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ");
const usd = (c: number) =>
  `$${
    (c / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;

async function login(phone: string): Promise<string> {
  await (await fetch(`${base()}/auth/send-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base()}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function boot() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  emails.length = 0;
  texts.length = 0;
  const origEmail = EmailService.prototype.send;
  const origSms = SmsService.prototype.send;
  EmailService.prototype.send = function (input: SendEmailInput) {
    emails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  } as typeof origEmail;
  SmsService.prototype.send = function (input: SendSmsInput) {
    texts.push(input);
    return Promise.resolve({ ok: true });
  } as typeof origSms;
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  return {
    async stop() {
      await server.stop();
      EmailService.prototype.send = origEmail;
      SmsService.prototype.send = origSms;
      await resetKv();
    },
  };
}

/** $8,400 quote, 30% deposit INV-001 $2,520 paid, balance INV-002 $5,880
 *  sent, CO-001 +$2,800 on INV-002 (pending). */
async function seed(language: "en" | "es") {
  const sid = await login(CONTRACTOR_PHONE);
  const owner = (await new SessionStore().get(sid))!;
  const userId = owner.userId;
  await new UserStore().update(userId, {
    name: "Hans Builder",
    email: "hans.builder@example.com",
    language: "en",
  } as never);
  const customer = await new CustomerStore().create(userId, {
    name: "María Nguyen",
    email: CUSTOMER_EMAIL,
    phoneNumber: CUSTOMER_PHONE,
    language,
  } as never);
  const q = await new QuoteStore().create(userId, {
    customerId: customer.id,
    summary: "Bathroom remodel",
    jobName: "Bathroom remodel",
    lineItems: [{
      description: "Bathroom remodel",
      quantity: 1,
      unit: "job",
      price: 840_000,
    }],
    estimatedTotal: 840_000,
  } as never);
  await new QuoteStore().update(q.id, userId, { status: "accepted" });
  await new InvoiceStore().create(userId, {
    quoteId: q.id,
    customerId: customer.id,
    amount: 252_000,
    status: "paid",
    jobName: "Bathroom remodel",
  } as never);
  const balance = await new InvoiceStore().create(userId, {
    quoteId: q.id,
    customerId: customer.id,
    amount: 588_000,
    status: "sent",
    jobName: "Bathroom remodel",
  } as never);
  const co = await new ChangeOrderStore().create(userId, balance.id, {
    description: "Add a second vanity",
    deltaAmountCents: 280_000,
    quoteId: q.id,
    customerId: customer.id,
    originalAmountCents: 588_000,
  });
  return { coId: co.id, balanceId: balance.id };
}

async function approveAndRead(language: "en" | "es") {
  const { coId, balanceId } = await seed(language);
  const before = emails.length;
  const r = await fetch(`${base()}/change-orders/${coId}/approve`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ name: "María Nguyen" }),
  });
  assertEquals(r.status, 200, await r.text());
  const pub = await fetch(`${base()}/change-orders/${coId}/public`).then((
    x,
  ) => x.json());
  const inv = await new InvoiceStore().get(balanceId);
  const receipts = emails.slice(before).filter((e) =>
    String(e.to).toLowerCase().includes(CUSTOMER_EMAIL)
  );
  assertEquals(receipts.length, 1, "one receipt email to the customer");
  const sms = texts.filter((m) =>
    digitsOf(String(m.to)) === digitsOf(CUSTOMER_PHONE)
  ).map((m) => m.body).join(" | ");
  return {
    pub,
    inv,
    body: plain(receipts[0].htmlBody),
    sms,
  };
}

Deno.test("REQ-1055 (LOOP-007 q2-39): approving CO-001 (+$2,800) on an $8,400 deposit job → the receipt shows the job total /co shows ($11,200.00) labeled as the job total, and INV-002's $8,680.00 — en", async () => {
  const app = await boot();
  try {
    const { pub, inv, body, sms } = await approveAndRead("en");
    // the facts both surfaces draw from
    assertEquals(pub.jobNewAmount, 1_120_000, "/co's job total");
    assertEquals(inv.amount, 868_000, "INV-002 after the order");
    const job = usd(pub.jobNewAmount);
    assertEquals(job, "$11,200.00");

    assert(
      body.includes(job),
      `the receipt shows the job total /co heads with (${job}): ${body}`,
    );
    assert(
      /job total[^$]*\$11,200\.00/i.test(body),
      `the receipt labels ${job} as the job total: ${body}`,
    );
    assert(
      /\$8,680\.00/.test(body),
      `the receipt still shows INV-002's total $8,680.00: ${body}`,
    );
    assert(
      /job total[^$]*\$11,200\.00/i.test(sms),
      `the receipt text names the job total too: ${sms}`,
    );
  } finally {
    await app.stop();
  }
});

Deno.test("REQ-1055 (LOOP-007 q2-39): the same approval for a Spanish customer → the receipt says total del trabajo $11,200.00 and the invoice's $8,680.00 — es", async () => {
  const app = await boot();
  try {
    const { pub, body } = await approveAndRead("es");
    assertEquals(pub.jobNewAmount, 1_120_000, "/co's job total");
    assert(
      /total del trabajo[^$]*\$11,200\.00/i.test(body),
      `el comprobante nombra el total del trabajo $11,200.00: ${body}`,
    );
    assert(/\$8,680\.00/.test(body), `y el total de INV-002: ${body}`);
  } finally {
    await app.stop();
  }
});
