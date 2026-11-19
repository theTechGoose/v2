/**
 * REQ-1050 (LOOP-007 cycle 2, issue q2-36; amends REQ-342) — the signed
 * confirmation's customer links carry the send language.
 *
 * QA2's English customer email (005) "Pay the first invoice →" linked to
 * /i/<id> with no ?lang, and its "View the agreement online" link to /q/<id>
 * had none either. A browser that had opened a Spanish page earlier (pm_lang=es)
 * then showed "Factura" / "PENDIENTE" for an English job: /i and /q resolve
 * ?lang → pm_lang cookie → the document's language, so a bare link lets the
 * visitor's cookie override the English document. REQ-342: every link that
 * leaves with a send carries `?lang=<send language>`.
 *
 * SendSignedConfirmation already resolves the send language (REQ-715) — it
 * never put it on the /i and /q links (email) or on the signed text's /q link.
 *
 * Real coordinator + stores on an in-memory KV; only the email and SMS
 * providers are captured.
 */
import { assert, assertEquals } from "#std/assert";
import { SendSignedConfirmation } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { RenderQuotePdf } from "@paperwork/domain/coordinators/render-quote-pdf/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const U = "u-1050";

function rig() {
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const mails: SendEmailInput[] = [];
  const email = new EmailService();
  email.send = (m: SendEmailInput) => {
    mails.push(m);
    return Promise.resolve({ ok: true, messageId: "m-1050" });
  };
  const texts: SendSmsInput[] = [];
  const sms = new SmsService();
  sms.send = (input: SendSmsInput) => {
    texts.push(input);
    return Promise.resolve({ ok: true, sid: "SM-1050" });
  };
  const commsLog = new LogPaperworkMessage(
    new CommConversationStore(),
    new CommMessageStore(),
  );
  commsLog.run = () => Promise.resolve(undefined);
  commsLog.outbox = () => Promise.resolve(undefined as never);
  const pdf = new RenderQuotePdf();
  pdf.run = () => Promise.resolve(new Uint8Array([37, 80, 68, 70]));
  const flow = new SendSignedConfirmation(
    quotes,
    invoices,
    customers,
    new UserStore(),
    new BusinessIdentityStore(),
    pdf,
    email,
    sms,
    commsLog,
  );
  return { flow, quotes, invoices, customers, mails, texts };
}

/** Sign a 50/50 quote for a customer who reads `lang`; return what went out. */
async function signIn(lang: "en" | "es") {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const r = rig();
  const c = await r.customers.create(U, {
    name: "Linda Park",
    email: "linda@example.com",
    phoneNumber: "(512) 555-1234",
    language: lang,
  });
  const quote = await r.quotes.create(U, {
    summary: "Deck repair",
    lineItems: [],
    customerId: c.id,
    estimatedTotal: 2_000_00,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
    acceptedName: "Linda Park",
    terms: [{
      stepId: "payment_terms",
      label: "Payment terms",
      value: "50/50",
    }],
  });
  await r.flow.run(quote.id);
  const first = (await r.invoices.listByUser(U))
    .sort((a, b) => (a.installmentIndex ?? 0) - (b.installmentIndex ?? 0))[0];
  assert(first, "signing billed the first milestone");
  assertEquals(r.mails.length, 1, "one signed-confirmation email");
  const html = r.mails[0].htmlBody ?? "";
  assert(
    html.includes(`<html lang="${lang}"`),
    `the email itself is in ${lang}`,
  );
  return { quote, invoiceId: first.id, html, texts: r.texts };
}

/** every href in the email that points at `/<kind>/<id>` */
function hrefsTo(html: string, kind: "i" | "q", id: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)]
    .map((m) => m[1].replaceAll("&amp;", "&"))
    .filter((h) => new URL(h, "http://x").pathname === `/${kind}/${id}`);
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1050 (q2-36, REQ-342): a ${lang} signed-confirmation email's "Pay the first invoice" link is /i/<id>?lang=${lang}`, async () => {
    try {
      const { html, invoiceId } = await signIn(lang);
      const links = hrefsTo(html, "i", invoiceId);
      assert(links.length > 0, "the email links to the first invoice");
      assertEquals(
        links.map((h) => new URL(h, "http://x").search),
        links.map(() => `?lang=${lang}`),
        `every /i link carries ?lang=${lang}: ${JSON.stringify(links)}`,
      );
    } finally {
      await resetKv();
    }
  });

  Deno.test(`REQ-1050 (q2-36, REQ-342): a ${lang} signed-confirmation email's "View the agreement online" link is /q/<id>?lang=${lang}`, async () => {
    try {
      const { html, quote } = await signIn(lang);
      const links = hrefsTo(html, "q", quote.id);
      assert(links.length > 0, "the email links to the agreement");
      assertEquals(
        links.map((h) => new URL(h, "http://x").search),
        links.map(() => `?lang=${lang}`),
        `every /q link carries ?lang=${lang}: ${JSON.stringify(links)}`,
      );
    } finally {
      await resetKv();
    }
  });

  Deno.test(`REQ-1050 (q2-36, REQ-342): the ${lang} signed-confirmation text links to /q/<id>?lang=${lang}`, async () => {
    try {
      const { texts, quote } = await signIn(lang);
      assertEquals(texts.length, 1, "one signed-confirmation text");
      const url = /https?:\/\/\S+\/q\/\S+/.exec(texts[0].body)?.[0];
      assert(url, `the text links to /q: ${texts[0].body}`);
      assertEquals(
        url.replace(/[.,)]+$/, "").split("/q/")[1],
        `${quote.id}?lang=${lang}`,
        `the text's /q link carries ?lang=${lang}: ${texts[0].body}`,
      );
    } finally {
      await resetKv();
    }
  });
}
