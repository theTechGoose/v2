/**
 * REQ-1101 — LOOP-007 cycle 3, issue q3-28 ("Signed email says the owner will
 * reach out to set a start date that the agreement already states").
 * renderSignedConfirmationHtml builds its body from the fixed
 * `signedConfirm.email.bodyBase`, which always ends "{who} will reach out to
 * lock in a start day." / "{who} se comunicará contigo para fijar la fecha de
 * inicio." — even when the countersigned agreement it carries states a start
 * (the ISO `startDate`, or the start_date term "Next week"). REQ-682 already
 * fixed the same contradiction in the quote email (quoteEmailSteps step 3);
 * the signed email must follow the same rule: a set start is stated, and only
 * no start / TBD keeps the "reach out" sentence.
 *
 * Runs the real SendSignedConfirmation coordinator with KV :memory: and a
 * captured EmailService, so the HTML asserted is exactly what is sent.
 */
import { assert } from "#std/assert";
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
import type { QuoteTerm } from "@paperwork/dto/quote.ts";

/** The text a reader sees: tags dropped, whitespace collapsed. */
const visibleText = (html: string) =>
  html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

const REACH_OUT_EN = /reach out to lock in a start day/i;
const REACH_OUT_ES = /fijar la fecha de inicio/i;

async function signedEmailText(opts: {
  lang: "en" | "es";
  startDate?: string;
  startTerm?: string;
}): Promise<string> {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", "u-1"], {
    id: "u-1",
    phoneNumber: "+15125550701",
    name: "Dana Whitfield",
    email: "dana@test.dev",
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
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    ),
  );
  const customer = await customers.create("u-1", {
    name: "Maria Gonzalez",
    email: "maria@example.com",
    language: opts.lang,
  });
  const terms: QuoteTerm[] = opts.startTerm
    ? [{ stepId: "start_date", label: "Start date", value: opts.startTerm }]
    : [];
  const quote = await quotes.create("u-1", {
    customerId: customer.id,
    summary: "Fence repair",
    jobName: "Fence Repair",
    lineItems: [],
    estimatedTotal: 2_400_00,
    status: "accepted",
    acceptedAt: now,
    acceptedName: "Maria Gonzalez",
    terms,
    ...(opts.startDate ? { startDate: opts.startDate } : {}),
  });
  const result = await flow.run(quote.id);
  assert(result.ok, `the signed confirmation ran: ${JSON.stringify(result)}`);
  assert(sent.length === 1, `one signed-agreement email (got ${sent.length})`);
  return visibleText(sent[0].htmlBody);
}

Deno.test("REQ-1101 (q3-28) signed email (EN): start term 'Next week' — states the start, never 'will reach out to lock in a start day'", async () => {
  try {
    const text = await signedEmailText({ lang: "en", startTerm: "Next week" });
    assert(
      !REACH_OUT_EN.test(text),
      `the agreement already states the start, yet the email says: "${
        text.match(/[^.]*reach out[^.]*\./i)?.[0]
      }"`,
    );
    assert(
      /Work starts/i.test(text),
      `the email states when work starts: ${text.slice(0, 600)}`,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1101 (q3-28) signed email (ES): start term 'Next week' — states the start, never 'se comunicará contigo para fijar la fecha de inicio'", async () => {
  try {
    const text = await signedEmailText({ lang: "es", startTerm: "Next week" });
    assert(
      !REACH_OUT_ES.test(text),
      `the agreement already states the start, yet the email says: "${
        text.match(/[^.]*fecha de inicio[^.]*\./i)?.[0]
      }"`,
    );
    assert(
      /trabajo (empieza|comienza)/i.test(text),
      `the Spanish email states when work starts: ${text.slice(0, 600)}`,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1101 (q3-28) signed email (EN): ISO startDate 2026-12-07 — states 'Work starts' with the date, no 'reach out' sentence", async () => {
  try {
    const text = await signedEmailText({
      lang: "en",
      startDate: "2026-12-07",
    });
    assert(
      !REACH_OUT_EN.test(text),
      `the agreement states a start date, yet the email says: "${
        text.match(/[^.]*reach out[^.]*\./i)?.[0]
      }"`,
    );
    assert(
      /Work starts[^.]*Dec[a-z]*\.? 7/i.test(text),
      `the email names the start date: ${text.slice(0, 600)}`,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1101 (q3-28) signed email (ES): ISO startDate 2026-12-07 — states the date, no 'fijar la fecha de inicio'", async () => {
  try {
    const text = await signedEmailText({
      lang: "es",
      startDate: "2026-12-07",
    });
    assert(
      !REACH_OUT_ES.test(text),
      `the agreement states a start date, yet the email says: "${
        text.match(/[^.]*fecha de inicio[^.]*\./i)?.[0]
      }"`,
    );
    assert(
      /trabajo (empieza|comienza)[^.]*7[^.]*dic/i.test(text),
      `the Spanish email names the start date: ${text.slice(0, 600)}`,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1101 (q3-28) signed email: no start, or start 'TBD' — keeps '{who} will reach out to lock in a start day' (en) / 'fijar la fecha de inicio' (es)", async () => {
  try {
    for (const startTerm of [undefined, "TBD"]) {
      const en = await signedEmailText({ lang: "en", startTerm });
      assert(
        /Dana will reach out to lock in a start day/.test(en),
        `no set start (${startTerm ?? "none"}) keeps the reach-out sentence: ${
          en.slice(0, 600)
        }`,
      );
      const es = await signedEmailText({ lang: "es", startTerm });
      assert(
        REACH_OUT_ES.test(es),
        `sin inicio (${startTerm ?? "none"}) keeps the Spanish sentence: ${
          es.slice(0, 600)
        }`,
      );
    }
  } finally {
    await resetKv();
  }
});
