/**
 * REQ-1079 (LOOP-007 cycle 2, q2-68) — Raphael: "test every single aspect of
 * this application … one Opus agent per issue to do root cause analysis, then
 * one to write the test, then one to fix it and make it green."
 *
 * q2-68: a Spanish signed-agreement email attached "Agreement-Q-001.pdf" and
 * listed that English name in its body. In Spanish the signed copy is
 * "Acuerdo-<n>.pdf", both as the attachment and in the body's file card; in
 * English it stays "Agreement-<n>.pdf".
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
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { RenderQuotePdf } from "@paperwork/domain/coordinators/render-quote-pdf/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

async function signedEmail(lang: "es" | "en"): Promise<SendEmailInput> {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", "u-1"], {
    id: "u-1",
    phoneNumber: "+15125550701",
    name: "Marcus Reyes",
    email: "marcus@test.dev",
    language: "en",
    createdAt: now,
    updatedAt: now,
  });
  const identities = new BusinessIdentityStore();
  await identities.upsert("u-1", {
    businessName: "Vega Painting & Drywall",
    commsLanguage: lang,
  });
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const email = new EmailService();
  const sent: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    sent.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const flow = new SendSignedConfirmation(
    quotes,
    new InvoiceStore(),
    customers,
    new UserStore(),
    identities,
    new RenderQuotePdf(),
    email,
    new SmsService(),
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    ),
  );
  const customer = await customers.create("u-1", {
    name: "Dana Pruitt",
    email: "dana@example.com",
  });
  const quote = await quotes.create("u-1", {
    customerId: customer.id,
    summary: "Pintura de dormitorios",
    lineItems: [{
      description: "Pintura",
      quantity: 1,
      unit: "job",
      price: 500_00,
    }],
    estimatedTotal: 500_00,
    status: "accepted",
    acceptedAt: now,
    acceptedName: "Dana Pruitt",
  });
  const result = await flow.run(quote.id);
  assertEquals(result.ok, true);
  assertEquals(sent.length, 1, "one signed-confirmation email went");
  return sent[0];
}

const visibleText = (html: string) =>
  html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

Deno.test("REQ-1079 q2-68 send-signed-confirmation: a Spanish signed email attaches 'Acuerdo-<n>.pdf' and names it so in the body", async () => {
  try {
    const mail = await signedEmail("es");
    const name = mail.attachments?.[0]?.name ?? "";
    assert(
      /^Acuerdo-.+\.pdf$/.test(name),
      `the Spanish signed copy is named 'Acuerdo-…pdf' (got "${name}")`,
    );
    const text = visibleText(mail.htmlBody);
    assert(
      !/Agreement-\S+\.pdf/.test(text),
      `no English 'Agreement-….pdf' in the Spanish body: ${
        text.match(/\S+\.pdf/g)
      }`,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1079 q2-68 send-signed-confirmation: an English signed email keeps 'Agreement-<n>.pdf'", async () => {
  try {
    const mail = await signedEmail("en");
    const name = mail.attachments?.[0]?.name ?? "";
    assert(
      /^Agreement-.+\.pdf$/.test(name),
      `the English signed copy is named 'Agreement-…pdf' (got "${name}")`,
    );
  } finally {
    await resetKv();
  }
});
