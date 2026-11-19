/**
 * REQ-1046 — LOOP-007 cycle 2, issues q2-31 + q2-45 ("Signed email and subject
 * repeat the customer's name inside the job title"; "Same quote titled three
 * ways"). The chat model writes a quote's summary as "<job> — <customer>"
 * (REQ-576 binds the customer from that tail) and a separate Title Case
 * `jobName` without the customer. Every other email names the job by
 * `jobNameByLang[lang] ?? jobName`; the signed-agreement email used the raw
 * summary in its subject and its "locked in on <job>" subhead, so it read
 * "Signed: Master bath redo — Maria Gonzalez — countersigned PDF …" while the
 * approval email said "approved your quote for Master Bath Redo".
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
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

/** The text a reader sees: tags dropped, whitespace collapsed. */
const visibleText = (html: string) =>
  html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

async function signedEmail(opts: {
  customerLanguage?: "en" | "es";
  quote: {
    summary: string;
    jobName?: string;
    jobNameByLang?: Record<string, string>;
  };
}): Promise<SendEmailInput> {
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
    new BusinessIdentityStore(),
    new RenderQuotePdf(),
    email,
    new SmsService(),
    new LogPaperworkMessage(new CommConversationStore(), new CommMessageStore()),
  );
  const customer = await customers.create("u-1", {
    name: "Maria Gonzalez",
    email: "maria@example.com",
    ...(opts.customerLanguage ? { language: opts.customerLanguage } : {}),
  });
  const quote = await quotes.create("u-1", {
    customerId: customer.id,
    ...opts.quote,
    lineItems: [],
    estimatedTotal: 18_000_00,
    status: "accepted",
    acceptedAt: now,
    acceptedName: "Maria Gonzalez",
  });
  if (!opts.quote.jobName) {
    // a quote stored without a job name (the store would otherwise derive
    // one from the summary): the coordinator's summary fallback is in play
    const stored = await kv.get<Record<string, unknown>>(["quote", quote.id]);
    const { jobName: _drop, jobNameByLang: _drop2, ...rest } = stored.value!;
    await kv.set(["quote", quote.id], rest);
  }
  const result = await flow.run(quote.id);
  assertEquals(result.ok, true);
  assertEquals(sent.length, 1, "one signed-agreement email");
  return sent[0];
}

Deno.test("REQ-1046 (q2-31/q2-45) signed email (EN): subject and subhead name the job 'Master Bath Redo', never the summary's '— Maria Gonzalez' tail", async () => {
  try {
    const mail = await signedEmail({
      quote: {
        summary: "Master bath redo — Maria Gonzalez",
        jobName: "Master Bath Redo",
      },
    });
    assertEquals(
      mail.subject,
      "Signed: Master Bath Redo — countersigned PDF + first invoice · Q-001",
      "the subject names the job by its job name",
    );
    assert(
      !mail.subject.includes("Maria Gonzalez"),
      `the customer's name is not inside the job title: ${mail.subject}`,
    );
    const html = mail.htmlBody;
    assert(
      /locked in on <strong[^>]*>Master Bath Redo</.test(html),
      `the subhead is 'locked in on Master Bath Redo': ${
        visibleText(html).match(/locked in on [^.]*\./)?.[0]
      }`,
    );
    const subhead = visibleText(html).match(/locked in on [^.]*\./)?.[0] ?? "";
    assert(
      !subhead.includes("Maria Gonzalez"),
      `no customer name after 'locked in on': ${subhead}`,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1046 (q2-31) signed email (ES): a Spanish-reading customer gets the Spanish job name (jobNameByLang.es) in the subject and subhead", async () => {
  try {
    const mail = await signedEmail({
      customerLanguage: "es",
      quote: {
        summary: "Master bath redo — Maria Gonzalez",
        jobName: "Master Bath Redo",
        jobNameByLang: { en: "Master Bath Redo", es: "Remodelación del baño" },
      },
    });
    assertStringIncludes(
      mail.subject,
      "Firmado: Remodelación del baño — PDF refrendado + primera factura",
      "the Spanish subject names the Spanish job name",
    );
    assert(
      !mail.subject.includes("Maria Gonzalez"),
      `the customer's name is not inside the job title: ${mail.subject}`,
    );
    assert(
      /ya tienen cerrado <strong[^>]*>Remodelación del baño</.test(
        mail.htmlBody,
      ),
      `the Spanish subhead names the Spanish job: ${
        visibleText(mail.htmlBody).match(/ya tienen cerrado [^.]*\./)?.[0]
      }`,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1046 (q2-31) signed email with no job name: the summary fallback drops the '— Maria Gonzalez' tail", async () => {
  try {
    const mail = await signedEmail({
      quote: {
        summary: "Master bath redo — Maria Gonzalez",
      },
    });
    assert(
      !mail.subject.includes("Maria Gonzalez"),
      `the summary fallback drops the customer tail: ${mail.subject}`,
    );
    assertStringIncludes(mail.subject, "Signed: Master bath redo — countersigned");
  } finally {
    await resetKv();
  }
});
