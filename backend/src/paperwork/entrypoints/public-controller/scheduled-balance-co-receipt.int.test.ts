/**
 * REQ-1100 — LOOP-007 cycle 3, issue q3-25. Raphael: "test every single
 * aspect of this application … one Opus agent per issue to do root cause
 * analysis, then one to write the test, then one to fix it and make it
 * green."
 *
 * A deposit + balance signing leaves the balance INV-002 SCHEDULED — never
 * sent (REQ-697: a scheduled invoice is the owner's reminder). CO-001 hangs
 * on INV-002 (REQ-949's setup). When the customer approves it, the approval
 * receipt (REQ-948) must not point her at that unsent final-balance bill:
 * no `/i/<INV-002>` link, no "INV-002", no "View your invoice" / "your
 * invoice" — it names the job Q-001, in the email and in the text (REQ-949:
 * "the customer hears about an invoice only once it has reached them").
 *
 * Today `publishRevision` stamps publishedAt on the scheduled invoice, the
 * publishedAt-based `isIssued` then reads it as issued (subject "CO-001 on
 * INV-002", "Invoice INV-002 total"), and the receipt URL is always
 * /i/<invoiceId>.
 *
 * Integration over HTTP with the app booted (KV :memory:), transports
 * captured at their prototype like change-order-receipt-total.int.test.ts.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
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

const CONTRACTOR_PHONE = "+15125551001";
const CUSTOMER_PHONE = "+15125551002";
const CUSTOMER_EMAIL = "maria.lopez@example.com";

const emails: SendEmailInput[] = [];
const texts: SendSmsInput[] = [];
const digitsOf = (s: string) => s.replace(/\D/g, "").slice(-10);
const plain = (html = "") =>
  html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ");

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

/** Q-001 accepted (deposit + balance): INV-001 deposit sent, INV-002
 *  balance SCHEDULED (never sent), CO-001 +$1,150 on INV-002 (pending). */
async function seed(language: "en" | "es") {
  const sid = await login(CONTRACTOR_PHONE);
  const owner = (await new SessionStore().get(sid))!;
  const userId = owner.userId;
  await new UserStore().update(userId, {
    name: "Walt Whitfield",
    email: "walt@example.com",
    language: "en",
  } as never);
  const customer = await new CustomerStore().create(userId, {
    name: "Maria Lopez",
    email: CUSTOMER_EMAIL,
    phoneNumber: CUSTOMER_PHONE,
    language,
  } as never);
  const q = await new QuoteStore().create(userId, {
    customerId: customer.id,
    summary: "Fence repaint",
    jobName: "Fence repaint",
    lineItems: [{
      description: "Fence repaint",
      quantity: 1,
      unit: "job",
      price: 902_500,
    }],
    estimatedTotal: 902_500,
  } as never);
  await new QuoteStore().update(q.id, userId, {
    status: "accepted",
    acceptedAt: "2026-11-10T15:00:00Z",
  } as never);
  assertEquals((await new QuoteStore().get(q.id)).number, "Q-001");
  const deposit = await new InvoiceStore().create(userId, {
    quoteId: q.id,
    customerId: customer.id,
    amount: 451_000,
    status: "sent",
    sentAt: "2026-11-10T15:00:01Z",
    jobName: "Fence repaint",
  } as never);
  assertEquals(deposit.number, "INV-001");
  const balance = await new InvoiceStore().create(userId, {
    quoteId: q.id,
    customerId: customer.id,
    amount: 451_500,
    status: "scheduled",
    jobName: "Fence repaint",
  } as never);
  assertEquals(balance.number, "INV-002");
  assertEquals(balance.sentAt, undefined, "the balance was never sent");
  const co = await new ChangeOrderStore().create(userId, balance.id, {
    description: "Stain the gate",
    deltaAmountCents: 115_000,
    quoteId: q.id,
    customerId: customer.id,
    originalAmountCents: 451_500,
  });
  assertEquals(co.number, "CO-001");
  return { coId: co.id, balanceId: balance.id };
}

async function approveAndCapture(language: "en" | "es") {
  const { coId, balanceId } = await seed(language);
  const before = emails.length;
  const r = await fetch(`${base()}/change-orders/${coId}/approve`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ name: "Maria Lopez" }),
  });
  assertEquals(r.status, 200, await r.text());
  const inv = await new InvoiceStore().get(balanceId);
  const receipts = emails.slice(before).filter((e) =>
    String(e.to).toLowerCase().includes(CUSTOMER_EMAIL)
  );
  assertEquals(receipts.length, 1, "one receipt email to the customer");
  const sms = texts.filter((m) =>
    digitsOf(String(m.to)) === digitsOf(CUSTOMER_PHONE)
  ).map((m) => m.body);
  assertEquals(sms.length, 1, "one receipt text to the customer");
  return { coId, balanceId, inv, receipt: receipts[0], sms: sms[0] };
}

for (
  const [language, yourInvoice] of [
    ["en", /your invoice/i],
    ["es", /tu factura/i],
  ] as const
) {
  Deno.test(`REQ-1100 (LOOP-007 q3-25): approving CO-001 on the SCHEDULED balance INV-002 → the customer's receipt never links to /i/<INV-002>, never names INV-002 or "your invoice", and names the job Q-001 — ${language}`, async () => {
    const app = await boot();
    try {
      const { balanceId, inv, receipt, sms } = await approveAndCapture(
        language,
      );
      assertEquals(inv.status, "scheduled", "INV-002 is still unsent");
      const html = receipt.htmlBody ?? "";
      const invLink = `/i/${encodeURIComponent(balanceId)}`;
      const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
      assert(
        !hrefs.some((h) => h.includes(invLink)),
        `the receipt links to the unsent final-balance bill ${invLink}: ${
          hrefs.join(" ")
        }`,
      );
      assert(
        !sms.includes(invLink),
        `the receipt text links to the unsent final-balance bill: ${sms}`,
      );
      for (
        const [what, text] of [
          ["subject", receipt.subject],
          ["body", plain(html)],
          ["sms", sms],
        ] as const
      ) {
        assert(
          !text.includes("INV-002"),
          `customer ${what} cites INV-002, an invoice she never received: ${text}`,
        );
        assert(
          !yourInvoice.test(text),
          `customer ${what} points at "${yourInvoice.source}" for an unsent invoice: ${text}`,
        );
        assertStringIncludes(text, "CO-001", `customer ${what} names CO-001`);
      }
      assertStringIncludes(receipt.subject, "Q-001", "subject names the job");
      assertStringIncludes(sms, "Q-001", "text names the job");
    } finally {
      await app.stop();
    }
  });
}
