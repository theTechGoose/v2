/**
 * REQ-954 (LOOP-007 cycle 1, q1-26) — "Deposit deadline: 'First invoice due
 * in 7 days' vs 'Before work starts'". The signed-confirmation email printed a
 * fixed "due in 7 days · pay online" (signedConfirm.email.invoiceDue) instead
 * of the first invoice's stored dueDate. The email must name the date the
 * invoice is actually due — the same date the invoice and /q carry — and never
 * "7 days" when the invoice is not due in 7 days (Due Now → today; no terms +
 * a later completion date → the completion date).
 */
import { assert, assertEquals } from "#std/assert";
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
import type { QuoteTerm } from "@paperwork/dto/quote.ts";

function freshRun() {
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const email = new EmailService();
  const sentEmails: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    sentEmails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const flow = new SendSignedConfirmation(
    quotes,
    invoices,
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
  return { quotes, invoices, customers, sentEmails, flow };
}

async function withKv<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  try {
    return await fn();
  } finally {
    await resetKv();
  }
}

const plusDaysIso = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Visible text of the email (tags stripped, whitespace collapsed). */
function emailText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

/** Does the email name this ISO date ("Nov 25" / "Nov 25, 2026" / "November 25")? */
function namesDate(text: string, iso: string): boolean {
  const short = shortDate(iso, "en", false); // "Nov 25"
  const [mon, day] = short.split(" ");
  return new RegExp(`\\b${mon}[a-z]*\\.? ${day}\\b`).test(text);
}

async function signAndCapture(opts: {
  terms?: QuoteTerm[];
  startDate?: string;
  estimatedCompletionDate?: string;
}) {
  const s = freshRun();
  const customer = await s.customers.create("u-1", {
    name: "Dana Whitfield",
    email: "dana@example.com",
  });
  const quote = await s.quotes.create("u-1", {
    customerId: customer.id,
    summary: "Kitchen remodel",
    lineItems: [],
    estimatedTotal: 23_250_00,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
    ...(opts.terms ? { terms: opts.terms } : {}),
    ...(opts.startDate ? { startDate: opts.startDate } : {}),
    ...(opts.estimatedCompletionDate
      ? { estimatedCompletionDate: opts.estimatedCompletionDate }
      : {}),
  });
  const result = await s.flow.run(quote.id);
  assert(result.invoiceId, "the signature bills a first invoice");
  const first = await s.invoices.get(result.invoiceId!);
  assertEquals(s.sentEmails.length, 1, "one signed-confirmation email");
  return { first, text: emailText(s.sentEmails[0].htmlBody) };
}

const PAY = (value: string): QuoteTerm[] => [{
  stepId: "payment_terms",
  label: "Payment",
  value,
}];

Deno.test("REQ-954 (LOOP-007 q1-26): Deposit + balance, start next week — the signed email's due line names the deposit invoice's stored dueDate", async () => {
  await withKv(async () => {
    const { first, text } = await signAndCapture({
      terms: PAY("Deposit + balance"),
      startDate: plusDaysIso(10),
      estimatedCompletionDate: plusDaysIso(24),
    });
    assert(first.dueDate, "the deposit carries a due date");
    assert(
      namesDate(text, first.dueDate!),
      `the email names the deposit's due date ${first.dueDate} (${
        shortDate(first.dueDate, "en", false)
      }); its text: ${text.match(/First invoice.{0,80}/)?.[0] ?? text}`,
    );
  });
});

Deno.test("REQ-954 (LOOP-007 q1-26): Due Now terms — the invoice is due today, so the email never says 'due in 7 days'", async () => {
  await withKv(async () => {
    const { first, text } = await signAndCapture({ terms: PAY("Due Now") });
    assertEquals(first.dueDate, plusDaysIso(0), "Due Now bills due today");
    assert(
      !/7 days/i.test(text),
      `the email must not promise 7 days for a Due Now invoice: ${
        text.match(/First invoice.{0,80}/)?.[0] ?? text
      }`,
    );
    assert(
      /\bdue today\b/i.test(text) || namesDate(text, first.dueDate!),
      `the email says the invoice is due today (or names ${first.dueDate})`,
    );
  });
});

Deno.test("REQ-954 (LOOP-007 q1-26): no terms + a completion date after net-7 — the email names the completion due date, never '7 days'", async () => {
  await withKv(async () => {
    const completion = plusDaysIso(30);
    const { first, text } = await signAndCapture({
      estimatedCompletionDate: completion,
    });
    assertEquals(first.dueDate, completion, "REQ-240: due on completion");
    assert(
      !/7 days/i.test(text),
      `the invoice is due ${completion}, not in 7 days: ${
        text.match(/First invoice.{0,80}/)?.[0] ?? text
      }`,
    );
    assert(
      namesDate(text, completion),
      `the email names the due date ${completion}`,
    );
  });
});
