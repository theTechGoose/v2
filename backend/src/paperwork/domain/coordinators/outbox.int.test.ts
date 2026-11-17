/**
 * REQ-784 — Raphael: "And yes to a sent message outbox." Demo-loop cycle
 * dv1, issue d12 "A sent-messages outbox shows every email and text that
 * went to customers" (cycle 1 m33: "/messages redirects to /assistant; no
 * way to check what was sent or in which language").
 *
 * Every customer-facing send records an outbox entry — sent, or not sent and
 * why — with the customer, channel, language, the document it carried, the
 * subject or first line, and the content exactly as the provider was handed
 * it. The owner's own heads-ups are not customer messages.
 *
 * Integration: the real senders and stores on an in-memory KV, the real
 * renderers; only the email/SMS providers are captured.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { SendPaperworkEmail } from "./send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "./send-paperwork-sms/mod.ts";
import { SendChangeOrderAlert } from "./send-change-order-alert/mod.ts";
import { SendPaymentReminder } from "./send-payment-reminder/mod.ts";
import { SendSignedConfirmation } from "./send-signed-confirmation/mod.ts";
import { ConfirmPayment } from "./confirm-payment/mod.ts";
import { MarkInvoicePaid } from "./mark-invoice-paid/mod.ts";
import { ComputeInvoiceBalance } from "./compute-invoice-balance/mod.ts";
import { RenderReceiptPdf } from "./render-receipt-pdf/mod.ts";
import { RenderQuotePdf } from "./render-quote-pdf/mod.ts";
import { ReplyToInquiry } from "./reply-to-inquiry/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { QuoteInquiryStore } from "@paperwork/domain/data/inquiry-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import type { CreateCustomerDto } from "@crm/dto/customer.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
  type SendEmailResult,
} from "@communication/domain/data/email-service/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { OutboxStore } from "@communication/domain/data/outbox-store/mod.ts";
import { WipeAccount } from "@users/domain/coordinators/wipe-account/mod.ts";
import type { OutboxEntry } from "@communication/dto/outbox.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import type { SendPaperworkEmail as EmailFlow } from "./send-paperwork-email/mod.ts";

const USER = "u-req784";
const OWNER_EMAIL = "luis@test.dev";
const OWNER_PHONE = "+15125557100";

function rig() {
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const shortlinks = new ShortLinkStore();
  const emails: SendEmailInput[] = [];
  let answer: (input: SendEmailInput) => SendEmailResult = () => ({
    ok: true,
    reason: "test_capture",
  });
  const email = new EmailService();
  email.send = (input: SendEmailInput) => {
    emails.push(input);
    return Promise.resolve(answer(input));
  };
  const texts: SendSmsInput[] = [];
  const sms = new SmsService();
  sms.send = (input: SendSmsInput) => {
    texts.push(input);
    return Promise.resolve({ ok: true, sid: "SM-784" });
  };
  const commsLog = new LogPaperworkMessage(
    new CommConversationStore(),
    new CommMessageStore(),
  );
  const mailer = new SendPaperworkEmail(
    quotes,
    invoices,
    customers,
    users,
    identity,
    email,
    commsLog,
  );
  const texter = new SendPaperworkSms(
    quotes,
    invoices,
    customers,
    users,
    identity,
    sms,
    shortlinks,
    commsLog,
  );
  return {
    quotes,
    invoices,
    customers,
    users,
    identity,
    shortlinks,
    email,
    sms,
    commsLog,
    emails,
    texts,
    mailer,
    texter,
    outbox: new OutboxStore(),
    refuseEmails(reason: string) {
      answer = () => ({ ok: false, reason });
    },
  };
}
type Rig = ReturnType<typeof rig>;

/** Luis (English app) runs Ortega Handyman Services. María reads Spanish;
 *  Tom's cell is a reserved 555 number; Nadia has no email. */
async function seed(r: Rig) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", USER], {
    id: USER,
    phoneNumber: OWNER_PHONE,
    name: "Luis Ortega",
    email: OWNER_EMAIL,
    language: "en",
    createdAt: now,
    updatedAt: now,
  });
  await r.identity.upsert(USER, { businessName: "Ortega Handyman Services" });
  const maria = await r.customers.create(USER, {
    name: "María López",
    email: "maria@example.com",
    phoneNumber: "+15125557151",
    language: "es",
  } as CreateCustomerDto);
  const tom = await r.customers.create(USER, {
    name: "Tom Reyes",
    email: "tom@example.com",
    phoneNumber: "(512) 555-0188",
    language: "en",
  } as CreateCustomerDto);
  const nadia = await r.customers.create(USER, {
    name: "Nadia Kim",
    phoneNumber: "+15125557153",
  } as CreateCustomerDto);
  return { maria, tom, nadia };
}

function quoteFor(r: Rig, customerId: string) {
  return r.quotes.create(USER, {
    customerId,
    summary: "Fence repair and gate",
    jobName: "Fence Repair",
    jobNameByLang: { en: "Fence Repair", es: "Reparación de cerca" },
    lineItems: [{
      description: "Fence + gate",
      quantity: 1,
      unit: "ea",
      price: 450_00,
    }],
    estimatedTotal: 450_00,
    status: "draft",
  });
}

function invoiceFor(r: Rig, customerId: string, extra: object = {}) {
  return r.invoices.create(USER, {
    customerId,
    amount: 450_00,
    dueDate: "2026-12-01",
    status: "sent",
    ...extra,
  } as never);
}

const one = (list: OutboxEntry[], pick: (e: OutboxEntry) => boolean) => {
  const hits = list.filter(pick);
  assertEquals(hits.length, 1, JSON.stringify(list, null, 1));
  return hits[0];
};

Deno.test("REQ-784 d12: a quote emailed and texted to María (Spanish) is two outbox entries — email and text, es, sent, her name, the subject / first line — and each opens to exactly what she was sent", async () => {
  const r = rig();
  try {
    const { maria } = await seed(r);
    const q = await quoteFor(r, maria.id);
    const mailed = await r.mailer.run(USER, {
      kind: "quote",
      resourceId: q.id,
    });
    assertEquals(mailed.ok, true, mailed.reason);
    const texted = await r.texter.run(USER, {
      kind: "quote",
      resourceId: q.id,
    });
    assertEquals(texted.ok, true, texted.reason);
    const number = (await r.quotes.getOwned(q.id, USER)).number;
    assert(number, "the sent quote carries its number");

    const list = await r.outbox.listByUser(USER);
    assertEquals(list.length, 2, JSON.stringify(list, null, 1));
    const mail = one(list, (e) => e.channel === "email");
    assertEquals(mail.status, "sent");
    assertEquals(mail.language, "es");
    assertEquals(mail.kind, "quote");
    assertEquals(mail.customerId, maria.id);
    assertEquals(mail.customerName, "María López");
    assertEquals(mail.to, "maria@example.com");
    assertEquals(mail.docId, q.id);
    assertEquals(mail.docRef, number);
    assertEquals(mail.subject, r.emails[0].subject);
    assertEquals(mail.preview, r.emails[0].subject);
    assert(
      mail.subject?.startsWith("Cotización"),
      `the subject is Spanish: ${mail.subject}`,
    );
    assertEquals(
      "body" in mail,
      false,
      "a list entry carries no body — opening one reads it",
    );
    const mailOpened = await r.outbox.getOwned(mail.id, USER);
    assertEquals(mailOpened.body, r.emails[0].htmlBody, "the email as sent");

    const text = one(list, (e) => e.channel === "text");
    assertEquals(text.status, "sent");
    assertEquals(text.language, "es");
    assertEquals(text.kind, "quote");
    assertEquals(text.customerName, "María López");
    assertEquals(text.to, "+15125557151");
    assertEquals(text.docRef, number);
    assertEquals(
      text.preview,
      r.texts[0].body.split("\n").map((l) => l.trim()).find(Boolean),
    );
    const textOpened = await r.outbox.getOwned(text.id, USER);
    assertEquals(textOpened.body, r.texts[0].body, "the text as sent");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-784 d12: a text refused before the provider (Tom's 555 number) is listed 'not sent' with its why — and nothing was texted", async () => {
  const r = rig();
  try {
    const { tom } = await seed(r);
    const q = await quoteFor(r, tom.id);
    const texted = await r.texter.run(USER, {
      kind: "quote",
      resourceId: q.id,
    });
    assertEquals(texted.ok, false);
    assertEquals(r.texts.length, 0, "nothing reached the provider");

    const [entry] = await r.outbox.listByUser(USER);
    assert(entry, "the refused text is in the outbox");
    assertEquals(entry.channel, "text");
    assertEquals(entry.status, "not_sent");
    assertEquals(entry.reasonCode, "fictional");
    assertStringIncludes(entry.reason ?? "", "555");
    assertEquals(entry.language, "en");
    assertEquals(entry.customerName, "Tom Reyes");
    assertEquals(entry.to, "+15125550188");
    assertEquals(
      (await r.outbox.getOwned(entry.id, USER)).body,
      "",
      "nothing went, so there is no content as sent",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-784 d12: an invoice emailed to María is an invoice entry — its number, Spanish, sent, the HTML as sent", async () => {
  const r = rig();
  try {
    const { maria } = await seed(r);
    const inv = await invoiceFor(r, maria.id);
    const mailed = await r.mailer.run(USER, {
      kind: "invoice",
      resourceId: inv.id,
    });
    assertEquals(mailed.ok, true, mailed.reason);
    const [entry] = await r.outbox.listByUser(USER);
    assertEquals(entry.kind, "invoice");
    assertEquals(entry.channel, "email");
    assertEquals(entry.status, "sent");
    assertEquals(entry.language, "es");
    assertEquals(
      entry.docRef,
      (await r.invoices.getOwned(inv.id, USER)).number,
    );
    assert(entry.subject?.startsWith("Factura"), entry.subject);
    assertEquals(
      (await r.outbox.getOwned(entry.id, USER)).body,
      r.emails[0].htmlBody,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-784 d12: a change order reaches María by email and text — both listed as the change order, in Spanish, with what she got; the owner's own heads-ups are not", async () => {
  const r = rig();
  try {
    const { maria } = await seed(r);
    const inv = await invoiceFor(r, maria.id);
    const changeOrders = new ChangeOrderStore();
    const co = await changeOrders.create(USER, inv.id, {
      description: "Second coat of stain",
      deltaAmountCents: 120_00,
      customerId: maria.id,
    });
    const res = await new SendChangeOrderAlert(
      changeOrders,
      r.customers,
      r.users,
      r.identity,
      r.email,
      r.sms,
      r.invoices,
    ).run(co.id);
    assertEquals(res.ok, true);

    const list = await r.outbox.listByUser(USER);
    assertEquals(
      list.filter((e) => e.to === OWNER_EMAIL || e.to === OWNER_PHONE).length,
      0,
      "the owner's own alerts are not customer messages",
    );
    assertEquals(list.length, 2, JSON.stringify(list, null, 1));
    const mail = one(list, (e) => e.channel === "email");
    const text = one(list, (e) => e.channel === "text");
    const coNumber = (await changeOrders.get(co.id)).number;
    for (const e of [mail, text]) {
      assertEquals(e.kind, "changeOrder");
      assertEquals(e.status, "sent");
      assertEquals(e.language, "es");
      assertEquals(e.customerName, "María López");
      assertEquals(e.docId, co.id);
      assertEquals(e.docRef, coNumber);
    }
    const sentMail = r.emails.find((e) => e.to === "maria@example.com")!;
    assertEquals(mail.subject, sentMail.subject);
    assertEquals(
      (await r.outbox.getOwned(mail.id, USER)).body,
      sentMail.htmlBody,
    );
    const sentText = r.texts.find((t) => t.to === "+15125557151")!;
    assertEquals((await r.outbox.getOwned(text.id, USER)).body, sentText.body);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-784 d12: a change order to Tom (555 cell) — the email is sent, the text is listed 'not sent' because the number can't receive texts", async () => {
  const r = rig();
  try {
    const { tom } = await seed(r);
    const inv = await invoiceFor(r, tom.id);
    const changeOrders = new ChangeOrderStore();
    const co = await changeOrders.create(USER, inv.id, {
      description: "Extra post",
      deltaAmountCents: 80_00,
      customerId: tom.id,
    });
    await new SendChangeOrderAlert(
      changeOrders,
      r.customers,
      r.users,
      r.identity,
      r.email,
      r.sms,
      r.invoices,
    ).run(co.id);
    const list = await r.outbox.listByUser(USER);
    assertEquals(one(list, (e) => e.channel === "email").status, "sent");
    const text = one(list, (e) => e.channel === "text");
    assertEquals(text.status, "not_sent");
    assertEquals(text.reasonCode, "fictional");
    assertEquals(text.kind, "changeOrder");
    assertEquals(r.texts.filter((t) => t.to !== OWNER_PHONE).length, 0);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-784 d12: an email the provider refused is listed 'not sent' with the provider's reason; one with no address on file says so", async () => {
  const r = rig();
  try {
    const { maria, nadia } = await seed(r);
    r.refuseEmails("postmark 422: Invalid 'To' address");
    const q = await quoteFor(r, maria.id);
    const refused = await r.mailer.run(USER, {
      kind: "quote",
      resourceId: q.id,
    });
    assertEquals(refused.ok, false);
    const nq = await quoteFor(r, nadia.id);
    const nowhere = await r.mailer.run(USER, {
      kind: "quote",
      resourceId: nq.id,
    });
    assertEquals(nowhere.ok, false);

    const list = await r.outbox.listByUser(USER);
    const toMaria = one(list, (e) => e.customerId === maria.id);
    assertEquals(toMaria.channel, "email");
    assertEquals(toMaria.status, "not_sent");
    assertEquals(toMaria.reasonCode, "other");
    assertStringIncludes(toMaria.reason ?? "", "422");
    assertEquals((await r.outbox.getOwned(toMaria.id, USER)).body, "");
    const toNadia = one(list, (e) => e.customerId === nadia.id);
    assertEquals(toNadia.status, "not_sent");
    assertEquals(toNadia.reasonCode, "missing");
    assertEquals(toNadia.customerName, "Nadia Kim");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-784 d12: the receipt, the signed copy, an overdue reminder and an inquiry answer are customer messages too — each listed with what it was", async () => {
  const r = rig();
  try {
    const { maria } = await seed(r);
    // signed copy (email + text)
    const pdf = new RenderQuotePdf();
    pdf.run = () => Promise.resolve(new Uint8Array([37, 80, 68, 70]));
    const signedQuote = await r.quotes.create(USER, {
      customerId: maria.id,
      summary: "Reparación de cerca",
      lineItems: [],
      estimatedTotal: 450_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      acceptedName: "María López",
    });
    await new SendSignedConfirmation(
      r.quotes,
      r.invoices,
      r.customers,
      r.users,
      r.identity,
      pdf,
      r.email,
      r.sms,
      r.commsLog,
    ).run(signedQuote.id);

    // receipt (email + text)
    const payments = new PaymentStore();
    const receiptPdf = new RenderReceiptPdf();
    receiptPdf.run = () => Promise.resolve(new Uint8Array([37, 80, 68, 70]));
    const markPaid = new MarkInvoicePaid({} as EmailFlow, r.invoices);
    markPaid.run = () => Promise.resolve();
    const claimed = await invoiceFor(r, maria.id, {
      status: "claimed",
      paymentIntent: {
        method: "zelle",
        amount: 450_00,
        claimedAt: new Date().toISOString(),
      },
    });
    await new ConfirmPayment(
      r.invoices,
      payments,
      r.customers,
      r.users,
      r.identity,
      r.email,
      r.sms,
      r.shortlinks,
      receiptPdf,
      r.commsLog,
      new EventBus(),
      markPaid,
      new ComputeInvoiceBalance(r.invoices, payments, markPaid),
    ).run(USER, claimed.id);

    // overdue reminder, day 3 (email + text)
    const overdue = await invoiceFor(r, maria.id, { dueDate: "2026-01-01" });
    await new SendPaymentReminder(
      r.invoices,
      r.customers,
      r.users,
      r.identity,
      r.email,
      r.sms,
      r.shortlinks,
      new EventBus(),
    ).runForInvoice(USER, overdue.id, 3, new Date("2026-01-05T12:00:00Z"));

    // the answer to her question (text)
    const inquiries = new QuoteInquiryStore();
    const asked = await quoteFor(r, maria.id);
    const inquiry = await inquiries.create({
      quoteId: asked.id,
      userId: USER,
      customerId: maria.id,
      question: "¿Incluye la puerta?",
      name: "María López",
      lang: "es",
    });
    assert(inquiry);
    const answered = await new ReplyToInquiry(
      inquiries,
      r.quotes,
      r.customers,
      r.users,
      r.identity,
      r.email,
      r.sms,
      r.commsLog,
    ).run(USER, {
      quoteId: asked.id,
      inquiryId: inquiry.id,
      channel: "text",
      message: "Sí, la puerta está incluida.",
    });
    assertEquals(answered.ok, true, answered.reason);

    const list = await r.outbox.listByUser(USER);
    const kinds = (k: string) =>
      list.filter((e) => e.kind === k).map((e) => e.channel).sort();
    assertEquals(kinds("signedCopy"), ["email", "text"]);
    assertEquals(kinds("receipt"), ["email", "text"]);
    assertEquals(kinds("reminder"), ["email", "text"]);
    assertEquals(kinds("reply"), ["text"]);
    for (const e of list) {
      assertEquals(e.status, "sent", JSON.stringify(e));
      assertEquals(e.language, "es", `${e.kind} ${e.channel}`);
      assertEquals(e.customerName, "María López");
      const opened = await r.outbox.getOwned(e.id, USER);
      const sent = e.channel === "email"
        ? r.emails.find((m) => m.subject === e.subject)?.htmlBody
        : r.texts.find((t) => t.body === opened.body)?.body;
      assertEquals(opened.body, sent, `${e.kind} ${e.channel}: as sent`);
    }
    assertEquals(
      list.filter((e) => e.to === OWNER_EMAIL || e.to === OWNER_PHONE).length,
      0,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-784 d12: the outbox is the account's own — another account's entry is never listed or opened", async () => {
  const r = rig();
  try {
    const { maria } = await seed(r);
    const q = await quoteFor(r, maria.id);
    await r.mailer.run(USER, { kind: "quote", resourceId: q.id });
    const [mine] = await r.outbox.listByUser(USER);
    assertEquals((await r.outbox.listByUser("someone-else")).length, 0);
    let refused = false;
    try {
      await r.outbox.getOwned(mine.id, "someone-else");
    } catch {
      refused = true;
    }
    assert(refused, "another account cannot open it");
    assertEquals(mine.userId, USER, "every entry carries its account");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-784 d12: the account wipe (GET /me/wipe) takes the whole outbox — entries, index and every body page — and leaves another account's alone", async () => {
  const r = rig();
  try {
    const { maria } = await seed(r);
    const q = await quoteFor(r, maria.id);
    await r.mailer.run(USER, { kind: "quote", resourceId: q.id });
    // a body long enough to span several KV pages
    await r.commsLog.outbox({
      userId: USER,
      channel: "text",
      kind: "reminder",
      language: "en",
      ok: true,
      body: "é".repeat(60_000),
    });
    const theirs = await r.commsLog.outbox({
      userId: "someone-else",
      channel: "email",
      kind: "invoice",
      language: "en",
      ok: true,
      subject: "Theirs",
      body: "<p>theirs</p>",
    });
    assert(theirs, "the other account's entry is recorded");
    const kv = await getKv();
    const outboxKeys = async () => {
      const keys: Deno.KvKey[] = [];
      for (const prefix of ["outbox", "outbox_by_user", "outbox_body"]) {
        for await (const e of kv.list({ prefix: [prefix] })) keys.push(e.key);
      }
      return keys;
    };
    const mine = (await outboxKeys()).filter((k) => k.includes(USER));
    assert(
      mine.filter((k) => k[0] === "outbox_body").length >= 4,
      `the long body is paged: ${JSON.stringify(mine)}`,
    );

    await new WipeAccount().run(USER);

    const left = await outboxKeys();
    assertEquals(
      left.length,
      3,
      `only the other account's entry, index and page are left: ${
        JSON.stringify(left)
      }`,
    );
    assert(
      left.every((k) => k.includes(theirs.id)),
      JSON.stringify(left),
    );
    assertEquals((await r.outbox.listByUser(USER)).length, 0);
    assertEquals(
      (await r.outbox.getOwned(theirs.id, "someone-else")).body,
      "<p>theirs</p>",
    );
  } finally {
    await resetKv();
  }
});
