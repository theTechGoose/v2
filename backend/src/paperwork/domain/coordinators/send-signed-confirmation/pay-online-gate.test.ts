/**
 * REQ-1054 (LOOP-007 cycle 2, q2-37) — "Signed email and /q say 'pay online'
 * but /i says to contact the contractor (no online payment set up)".
 *
 * The signed-confirmation email's due line came from the fixed strings
 * `signedConfirm.email.invoiceDue` = "due {date} · pay online" /
 * `invoiceDueToday` = "due today · pay online", whatever the business takes.
 * A business with no online way to pay (no Venmo / Zelle / Cash App / PayPal /
 * card link, no Stripe, no Square) gets /i's "contact your contractor"
 * fallback, so the email must not promise "pay online" — while a business
 * that takes Venmo still says it (the REQ-630 `payWaysSmsLine` gate).
 */
import { assert } from "#std/assert";
import { SendSignedConfirmation } from "./mod.ts";
import { shortDate } from "#documents/linked-view.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { RenderQuotePdf } from "@paperwork/domain/coordinators/render-quote-pdf/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import type { AcceptedPaymentMethods } from "@users/dto/business-identity.ts";

const plusDaysIso = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function emailText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

async function signedEmail(opts: {
  methods?: AcceptedPaymentMethods;
  lang?: "en" | "es";
}): Promise<{ text: string; due: string; preheader: string }> {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  try {
    const quotes = new QuoteStore();
    const invoices = new InvoiceStore();
    const customers = new CustomerStore();
    const identity = new BusinessIdentityStore();
    const email = new EmailService();
    const sent: SendEmailInput[] = [];
    email.send = (input: SendEmailInput) => {
      sent.push(input);
      return Promise.resolve({ ok: true, reason: "test_capture" });
    };
    await identity.upsert("u-1", {
      businessName: "Northside Builders",
      ...(opts.lang === "es" ? { commsLanguage: "es" } : {}),
      ...(opts.methods ? { acceptedPaymentMethods: opts.methods } : {}),
    } as never);
    const flow = new SendSignedConfirmation(
      quotes,
      invoices,
      customers,
      new UserStore(),
      identity,
      new RenderQuotePdf(),
      email,
      new SmsService(),
      new LogPaperworkMessage(
        new CommConversationStore(),
        new CommMessageStore(),
      ),
    );
    const customer = await customers.create("u-1", {
      name: "Dana Whitfield",
      email: "dana@example.com",
    });
    const quote = await quotes.create("u-1", {
      customerId: customer.id,
      summary: "Kitchen remodel",
      lineItems: [],
      estimatedTotal: 2_520_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      estimatedCompletionDate: plusDaysIso(10),
    });
    const result = await flow.run(quote.id);
    assert(result.invoiceId, "the signature bills a first invoice");
    const first = await invoices.get(result.invoiceId!);
    assert(first?.dueDate, "the first invoice has a due date");
    assert(sent.length === 1, `one signed-confirmation email (${sent.length})`);
    return {
      text: emailText(sent[0].htmlBody),
      due: first.dueDate!,
      preheader: preheaderOf(sent[0].htmlBody),
    };
  } finally {
    await resetKv();
  }
}

/** The hidden inbox-preview span (display:none) right after <body>. */
function preheaderOf(html: string): string {
  const m = html.match(/<span style="display:none[^"]*">([\s\S]*?)<\/span>/);
  assert(m, "the signed email carries a hidden preheader span");
  return emailText(m[1]).trim();
}

function dueLine(text: string): string {
  return text.match(/.{0,40}(pay online|paga en l[ií]nea).{0,20}/i)?.[0] ??
    text.match(/.{0,40}\b(due|vence)\b.{0,40}/i)?.[0] ?? text;
}

Deno.test("REQ-1054 (LOOP-007 q2-37): a business with no online pay way (no methods, no Stripe, no Square) — the signed email names the due date but never says 'pay online'", async () => {
  const { text, due } = await signedEmail({});
  const short = shortDate(due, "en", false);
  assert(
    text.includes(short),
    `the due line still names the date ${short}: ${dueLine(text)}`,
  );
  assert(
    !/pay online/i.test(text),
    `nothing to pay with online (/i says "contact your contractor"), yet the email says: ${
      dueLine(text)
    }`,
  );
});

Deno.test("REQ-1054 (LOOP-007 q2-37): only offline methods (cash, check) — the signed email does not say 'pay online'", async () => {
  const { text } = await signedEmail({
    methods: {
      cash: { enabled: true },
      check: { enabled: true, mailTo: "PO Box 1" },
    } as AcceptedPaymentMethods,
  });
  assert(
    !/pay online/i.test(text),
    `cash and check are not online, yet the email says: ${dueLine(text)}`,
  );
});

Deno.test("REQ-1054 (LOOP-007 q2-37): Spanish — no online pay way, so no 'paga en línea'", async () => {
  const { text } = await signedEmail({ lang: "es" });
  assert(
    !/paga en l[ií]nea/i.test(text),
    `sin forma de pago en línea, el email dice: ${dueLine(text)}`,
  );
});

Deno.test("REQ-1054 (LOOP-007 q2-37): a business that takes Venmo — the signed email still says 'pay online'", async () => {
  const { text } = await signedEmail({
    methods: {
      venmo: { enabled: true, handle: "@northside" },
    } as AcceptedPaymentMethods,
  });
  assert(
    /pay online/i.test(text),
    `Venmo is an online way to pay: ${dueLine(text)}`,
  );
});

// ── REQ-1168 (REQ-1054 AMENDMENT, LOOP-007 q3-102): the hidden preheader ──
// The inbox preview text next to the subject came from
// `signedConfirm.email.preheaderReady` ("ready to pay" / "lista para pagar")
// whenever an invoice exists, regardless of payOnline.

Deno.test("REQ-1168 (REQ-1054 AMENDMENT, LOOP-007 q3-102): no online pay way — the signed email's hidden preheader does not say the first invoice is 'ready to pay'", async () => {
  const { preheader } = await signedEmail({});
  assert(
    !/ready to pay/i.test(preheader),
    `nothing to pay with online, yet the inbox preview says: "${preheader}"`,
  );
});

Deno.test("REQ-1168 (REQ-1054 AMENDMENT, LOOP-007 q3-102): Spanish, no online pay way — the preheader does not say 'lista para pagar'", async () => {
  const { preheader } = await signedEmail({ lang: "es" });
  assert(
    !/lista para pagar/i.test(preheader),
    `sin forma de pago en línea, la vista previa dice: "${preheader}"`,
  );
});

Deno.test("REQ-1168 (REQ-1054 AMENDMENT, LOOP-007 q3-102): a business that takes Venmo — the preheader still says 'ready to pay'", async () => {
  const { preheader } = await signedEmail({
    methods: {
      venmo: { enabled: true, handle: "@northside" },
    } as AcceptedPaymentMethods,
  });
  assert(
    /ready to pay/i.test(preheader),
    `Venmo is an online way to pay: "${preheader}"`,
  );
});
