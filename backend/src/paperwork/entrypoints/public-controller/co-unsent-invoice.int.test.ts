/**
 * REQ-1099 — LOOP-007 cycle 3, issue q3-24. Raphael: "test every single
 * aspect of this application … one Opus agent per issue to do root cause
 * analysis, then one to write the test, then one to fix it and make it
 * green."
 *
 * After a deposit + balance signing the balance INV-002 is only SCHEDULED —
 * the customer never received it. A change order hung on it must never cite
 * INV-002 to the customer (REQ-949). The request email already obeys; the
 * rest did not:
 *   - GET /change-orders/:id/public (the /co page) hands out an invoice link
 *     {number: "INV-002", url: "/i/<balance>"} for the unsent invoice;
 *   - approving publishes a revision (publishedAt stamped, status still
 *     "scheduled"), after which the customer's receipt reads
 *     "CO-001 on INV-002" and links /i/<balance>.
 *
 * Integration over HTTP with the app booted (KV :memory:), transports
 * captured at their prototype like change-order-receipt-total.int.test.ts.
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

const CONTRACTOR_PHONE = "+15125551099";
const CUSTOMER_PHONE = "+15125551098";
const CUSTOMER_EMAIL = "randall.belknap@example.com";

const emails: SendEmailInput[] = [];
const texts: SendSmsInput[] = [];
const digitsOf = (s: string) => s.replace(/\D/g, "").slice(-10);

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

/** Q-001 accepted; deposit INV-001 sent; balance INV-002 SCHEDULED (never
 *  sent); CO-001 +$1,250 on INV-002, pending. */
async function seed(language: "en" | "es") {
  const sid = await login(CONTRACTOR_PHONE);
  const userId = (await new SessionStore().get(sid))!.userId;
  await new UserStore().update(userId, {
    name: "Hans Builder",
    email: "hans.builder@example.com",
    language: "en",
  } as never);
  const customer = await new CustomerStore().create(userId, {
    name: "Randall Belknap",
    email: CUSTOMER_EMAIL,
    phoneNumber: CUSTOMER_PHONE,
    language,
  } as never);
  const quotes = new QuoteStore();
  const q = await quotes.create(userId, {
    customerId: customer.id,
    summary: "Patio",
    jobName: "Patio",
    lineItems: [{
      description: "Patio",
      quantity: 1,
      unit: "job",
      price: 2_325_000,
    }],
    estimatedTotal: 2_325_000,
  } as never);
  await quotes.update(q.id, userId, { status: "accepted" });
  const invoices = new InvoiceStore();
  const deposit = await invoices.create(userId, {
    quoteId: q.id,
    customerId: customer.id,
    amount: 465_000,
    status: "sent",
    sentAt: "2026-11-01T15:00:01Z",
    jobName: "Patio",
  } as never);
  assertEquals(deposit.number, "INV-001");
  const balance = await invoices.create(userId, {
    quoteId: q.id,
    customerId: customer.id,
    amount: 1_860_000,
    status: "scheduled",
    jobName: "Patio",
  } as never);
  assertEquals(balance.number, "INV-002");
  assertEquals(balance.sentAt, undefined, "the balance was never sent");
  const co = await new ChangeOrderStore().create(userId, balance.id, {
    description: "Extra pavers",
    deltaAmountCents: 125_000,
    quoteId: q.id,
    customerId: customer.id,
    originalAmountCents: 1_860_000,
  });
  assertEquals(co.number, "CO-001");
  return { coId: co.id, balanceId: balance.id, quoteNumber: q.number };
}

for (const language of ["en", "es"] as const) {
  Deno.test(`REQ-1099 (LOOP-007 q3-24): /co's public projection for CO-001 on the scheduled, never-sent INV-002 carries no INV-002 link — ${language}`, async () => {
    const app = await boot();
    try {
      const { coId, balanceId } = await seed(language);
      const pub = await fetch(`${base()}/change-orders/${coId}/public`).then(
        (r) => r.json(),
      );
      const raw = JSON.stringify(pub.invoice ?? null);
      assert(
        !pub.invoice?.number && !pub.invoice?.url,
        `GET /change-orders/:id/public hands the customer a link to INV-002, an invoice she never received: ${raw}`,
      );
      assert(
        !JSON.stringify(pub).includes(`/i/${balanceId}`),
        `the projection links /i/<scheduled balance>: ${raw}`,
      );
      assertEquals(pub.quote?.number, "Q-001", "the job link stays");
    } finally {
      await app.stop();
    }
  });

  Deno.test(`REQ-1099 (LOOP-007 q3-24): approving CO-001 on the scheduled INV-002 → the customer's receipt email + text name Q-001, never INV-002 or /i/<balance> — ${language}`, async () => {
    const app = await boot();
    try {
      const { coId, balanceId } = await seed(language);
      const before = { e: emails.length, t: texts.length };
      const r = await fetch(`${base()}/change-orders/${coId}/approve`, {
        method: "POST",
        headers: J,
        body: JSON.stringify({ name: "Randall Belknap" }),
      });
      assertEquals(r.status, 200, await r.text());
      const inv = await new InvoiceStore().get(balanceId);
      assertEquals(
        inv.status,
        "scheduled",
        "the balance is still unsent after the approval",
      );
      assertEquals(inv.sentAt, undefined, "still never sent");
      const receipts = emails.slice(before.e).filter((e) =>
        String(e.to).toLowerCase().includes(CUSTOMER_EMAIL)
      );
      assertEquals(receipts.length, 1, "one receipt email to the customer");
      const sms = texts.slice(before.t).filter((m) =>
        digitsOf(String(m.to)) === digitsOf(CUSTOMER_PHONE)
      ).map((m) => m.body).join(" | ");
      for (
        const [what, text] of [
          ["subject", receipts[0].subject],
          ["htmlBody", receipts[0].htmlBody],
          ["sms", sms],
        ] as const
      ) {
        assert(
          !text.includes("INV-002"),
          `customer receipt ${what} cites INV-002, an invoice she never received: ${text}`,
        );
        assert(
          !text.includes(`/i/${balanceId}`),
          `customer receipt ${what} links /i/<scheduled balance>: ${text}`,
        );
      }
      assert(
        receipts[0].subject.includes("Q-001"),
        `the receipt subject names the job Q-001 (as the request did): ${
          receipts[0].subject
        }`,
      );
    } finally {
      await app.stop();
    }
  });
}
