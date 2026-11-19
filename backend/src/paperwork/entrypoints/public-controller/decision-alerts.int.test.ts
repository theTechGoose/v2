/**
 * REQ-948 — LOOP-007 cycle 1, issues q1-21 + q1-22. Raphael: "test every
 * single aspect of this application … one Opus agent per issue to do root
 * cause analysis, then one to write the test, then one to fix it and make it
 * green."
 *
 * The customer's three answers on a quote (accept, ask, decline) and her two
 * answers on a change order (approve, decline) must all reach the contractor
 * the same way: an email AND a text. Today accept (SendAcceptedAlert) and ask
 * (SendInquiryAlert, REQ-031) do; a quote decline and both change-order
 * decisions only emit a bus event, which NotifyOnEvent turns into an in-app
 * bell row — nothing is sent.
 *
 *   - q1-21: POST /change-orders/:id/approve texts + emails the contractor and
 *     emails the customer a receipt (what changed, the new total); decline
 *     texts + emails the contractor only; a second decision is 409 and sends
 *     nothing new.
 *   - q1-22: POST /quotes/:id/decline texts + emails the contractor with the
 *     reason and the note; a second decline sends nothing new.
 *
 * Integration over HTTP with the app booted (KV :memory:). The two transports
 * are captured at their prototype so every path that sends anything — a new
 * coordinator, SendPaperworkEmail, … — is seen; each capture answers ok.
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

const CONTRACTOR_PHONE = "+15125559481";
const CONTRACTOR_EMAIL = "hans.builder@example.com";
const CUSTOMER_PHONE = "+15125559482";
const CUSTOMER_EMAIL = "maria.nguyen@example.com";

const emails: SendEmailInput[] = [];
const texts: SendSmsInput[] = [];
const sent = () => ({ emails: emails.length, texts: texts.length });
const digitsOf = (s: string) => s.replace(/\D/g, "").slice(-10);
const emailsTo = (to: string, from = 0) =>
  emails.slice(from).filter((e) =>
    String(e.to).toLowerCase().includes(to.toLowerCase())
  );
const textsTo = (to: string, from = 0) =>
  texts.slice(from).filter((m) => digitsOf(String(m.to)) === digitsOf(to));
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

async function post(path: string, body: unknown = {}) {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: J,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** contractor with email + phone (en), customer María with email + phone */
async function seedContractor() {
  const sid = await login(CONTRACTOR_PHONE);
  const owner = (await new SessionStore().get(sid))!;
  await new UserStore().update(owner.userId, {
    name: "Hans Builder",
    email: CONTRACTOR_EMAIL,
    language: "en",
  } as never);
  const customer = await new CustomerStore().create(owner.userId, {
    name: "María Nguyen",
    email: CUSTOMER_EMAIL,
    phoneNumber: CUSTOMER_PHONE,
  });
  return { userId: owner.userId, customerId: customer.id };
}

/** an accepted $19,200 job, INV $9,600 sent, a pending +$850 change order */
async function seedOrder(userId: string, customerId: string) {
  const q = await new QuoteStore().create(userId, {
    customerId,
    summary: "Kitchen",
    jobName: "Kitchen remodel",
    lineItems: [{
      description: "Kitchen remodel",
      quantity: 1,
      unit: "job",
      price: 1_920_000,
    }],
    estimatedTotal: 1_920_000,
  } as never);
  await new QuoteStore().update(q.id, userId, { status: "accepted" });
  const inv = await new InvoiceStore().create(userId, {
    quoteId: q.id,
    customerId,
    amount: 960_000,
    status: "sent",
    jobName: "Kitchen remodel",
  } as never);
  const co = await new ChangeOrderStore().create(userId, inv.id, {
    description: "Add pantry shelving",
    deltaAmountCents: 85_000,
    quoteId: q.id,
    customerId,
    originalAmountCents: 960_000,
  });
  return co.id;
}

async function seedSentQuote(userId: string, customerId: string) {
  const q = await new QuoteStore().create(userId, {
    customerId,
    summary: "Backyard junk removal",
    jobName: "Backyard junk removal",
    lineItems: [{
      description: "Haul away",
      quantity: 1,
      unit: "job",
      price: 45_000,
    }],
    estimatedTotal: 45_000,
  } as never);
  await new QuoteStore().update(q.id, userId, { status: "sent" } as never);
  return q.id;
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

Deno.test("REQ-948 (LOOP-007 q1-21): the customer approves a change order → the contractor gets one text and one email naming her and the change, and she gets one receipt email with the new total; a second approve is 409 and sends nothing", async () => {
  const app = await boot();
  try {
    const { userId, customerId } = await seedContractor();
    const id = await seedOrder(userId, customerId);
    const before = sent();

    const r = await post(`/change-orders/${id}/approve`, {
      name: "María Nguyen",
    });
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals(
      (await new ChangeOrderStore().get(id)).status,
      "approved",
      "the approval itself landed",
    );

    const toContractorSms = textsTo(CONTRACTOR_PHONE, before.texts);
    const toContractorEmail = emailsTo(CONTRACTOR_EMAIL, before.emails);
    const toCustomerEmail = emailsTo(CUSTOMER_EMAIL, before.emails);
    assertEquals(
      toContractorSms.length,
      1,
      `the contractor got ${toContractorSms.length} texts after the approval (want 1)`,
    );
    assertEquals(
      toContractorEmail.length,
      1,
      `the contractor got ${toContractorEmail.length} emails after the approval (want 1)`,
    );
    assertEquals(
      toCustomerEmail.length,
      1,
      `the customer got ${toCustomerEmail.length} receipt emails after the approval (want 1)`,
    );

    const sms = toContractorSms[0].body;
    assert(/Mar[ií]a/.test(sms), `contractor text names the customer: ${sms}`);
    const mail = `${toContractorEmail[0].subject} ${
      plain(toContractorEmail[0].htmlBody)
    }`;
    assert(/Mar[ií]a/.test(mail), `contractor email names her: ${mail}`);
    assert(/pantry shelving/i.test(mail), `contractor email: what: ${mail}`);
    const receipt = `${toCustomerEmail[0].subject} ${
      plain(toCustomerEmail[0].htmlBody)
    }`;
    assert(/pantry shelving/i.test(receipt), `receipt: what: ${receipt}`);
    assert(/10,450/.test(receipt), `receipt: new invoice total: ${receipt}`);

    // a stale second click: 409, nothing new goes out
    const mid = sent();
    const again = await post(`/change-orders/${id}/approve`, { name: "M" });
    assertEquals(again.status, 409);
    assertEquals(sent(), mid, "a second approve sent another message");
  } finally {
    await app.stop();
  }
});

Deno.test("REQ-948 (LOOP-007 q1-21): the customer declines a change order → the contractor gets one text and one email; the customer gets nothing", async () => {
  const app = await boot();
  try {
    const { userId, customerId } = await seedContractor();
    const id = await seedOrder(userId, customerId);
    const before = sent();

    const r = await post(`/change-orders/${id}/decline`);
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals((await new ChangeOrderStore().get(id)).status, "declined");

    assertEquals(
      textsTo(CONTRACTOR_PHONE, before.texts).length,
      1,
      "the contractor got no text for the declined change order",
    );
    assertEquals(
      emailsTo(CONTRACTOR_EMAIL, before.emails).length,
      1,
      "the contractor got no email for the declined change order",
    );
    assertEquals(emailsTo(CUSTOMER_EMAIL, before.emails).length, 0);
    assertEquals(textsTo(CUSTOMER_PHONE, before.texts).length, 0);

    const mid = sent();
    const again = await post(`/change-orders/${id}/decline`);
    assertEquals(again.status, 409);
    assertEquals(sent(), mid, "a second decline sent another message");
  } finally {
    await app.stop();
  }
});

Deno.test("REQ-948 (LOOP-007 q1-22): the customer declines a quote with a reason and a note → the contractor gets one text and one email carrying both; a second decline sends nothing", async () => {
  const app = await boot();
  try {
    const { userId, customerId } = await seedContractor();
    const id = await seedSentQuote(userId, customerId);
    const before = sent();

    const r = await post(`/quotes/${id}/decline`, {
      reason: "price",
      note: "Found someone closer to home",
      name: "María Nguyen",
    });
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals((await new QuoteStore().get(id)).status, "lost");

    const toSms = textsTo(CONTRACTOR_PHONE, before.texts);
    const toEmail = emailsTo(CONTRACTOR_EMAIL, before.emails);
    assertEquals(
      toSms.length,
      1,
      `the contractor got ${toSms.length} texts for the declined quote (want 1)`,
    );
    assertEquals(
      toEmail.length,
      1,
      `the contractor got ${toEmail.length} emails for the declined quote (want 1)`,
    );
    const mail = `${toEmail[0].subject} ${plain(toEmail[0].htmlBody)}`;
    assert(/Mar[ií]a/.test(mail), `decline email names her: ${mail}`);
    assert(/price/i.test(mail), `decline email carries the reason: ${mail}`);
    assert(
      /Found someone closer to home/.test(mail),
      `decline email carries the note: ${mail}`,
    );
    assert(/Mar[ií]a/.test(toSms[0].body), `decline text: ${toSms[0].body}`);

    const mid = sent();
    const again = await post(`/quotes/${id}/decline`, { reason: "price" });
    assertEquals(again.status, 200);
    assertEquals(sent(), mid, "a second decline sent another message");
  } finally {
    await app.stop();
  }
});

Deno.test("REQ-948 control: the sibling quote ACCEPT already texts and emails the contractor through the same captured transports (proves the capture sees real sends)", async () => {
  const app = await boot();
  try {
    const { userId, customerId } = await seedContractor();
    const id = await seedSentQuote(userId, customerId);
    const before = sent();
    const r = await post(`/quotes/${id}/accept`, { name: "María Nguyen" });
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals(textsTo(CONTRACTOR_PHONE, before.texts).length, 1);
    assertEquals(emailsTo(CONTRACTOR_EMAIL, before.emails).length, 1);
  } finally {
    await app.stop();
  }
});
