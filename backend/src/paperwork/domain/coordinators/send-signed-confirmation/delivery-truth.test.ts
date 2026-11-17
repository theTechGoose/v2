/**
 * REQ-556 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue M7 (pair 7): a minute after "Couldn't
 * send… reserved test number", INV-001 showed SENT and the assistant said it
 * "went out automatically". SendSignedConfirmation billed the first milestone
 * as sent before any email or text was tried, and recorded nothing about the
 * delivery.
 *
 * Signing now records on the first milestone how its confirmation reached the
 * customer — `deliveredVia`: "email" when the confirmation email (with the
 * invoice's pay link) was delivered, "text" when the confirmation text was —
 * and an empty list when nothing could be delivered. The milestone stays
 * issued: the signer is handed it on /q (REQ-251's Pay now), so it is not
 * hidden as a draft (REQ-312).
 */
import { assertEquals } from "#std/assert";
import { SendSignedConfirmation } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailResult,
} from "@communication/domain/data/email-service/mod.ts";
import { type SendSmsResult, SmsService } from "@users/domain/data/sms/mod.ts";
import { RenderQuotePdf } from "@paperwork/domain/coordinators/render-quote-pdf/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function rig(
  emailAnswer: SendEmailResult = { ok: true },
  smsAnswer: SendSmsResult = { ok: true, sid: "SM-556" },
) {
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const email = new EmailService();
  email.send = () => Promise.resolve(emailAnswer);
  const sms = new SmsService();
  sms.send = () => Promise.resolve(smsAnswer);
  const commsLog = new LogPaperworkMessage(
    new CommConversationStore(),
    new CommMessageStore(),
  );
  commsLog.run = () => Promise.resolve(undefined);
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
  return { flow, quotes, invoices, customers };
}

/** sign a 50/50 quote for `customer` (none → a quote with no customer) and
 *  return the first milestone the signature billed */
async function signFor(
  r: ReturnType<typeof rig>,
  customer?: { name: string; phoneNumber?: string; email?: string },
) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const c = customer ? await r.customers.create("u-556", customer) : undefined;
  const quote = await r.quotes.create("u-556", {
    summary: "Deck repair",
    lineItems: [],
    ...(c ? { customerId: c.id } : {}),
    estimatedTotal: 2_000_00,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
    acceptedName: "Pat Signer",
    terms: [{
      stepId: "payment_terms",
      label: "Payment terms",
      value: "50/50",
    }],
  });
  await r.flow.run(quote.id);
  const rows = (await r.invoices.listByUser("u-556"))
    .sort((a, b) => (a.installmentIndex ?? 0) - (b.installmentIndex ?? 0));
  assertEquals(rows.length, 2);
  return rows[0];
}

Deno.test("REQ-556 (M7) signing: no email and a fictional 555-01XX number (pair 7) → the deposit records deliveredVia [] — nothing went out", async () => {
  const r = rig();
  try {
    const first = await signFor(r, {
      name: "Ana Torres",
      phoneNumber: "5125550177",
    });
    assertEquals(first.deliveredVia, []);
    // still issued: the signer is handed it on /q (REQ-251)
    assertEquals(first.status, "sent");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-556 (M7) signing: a quote with no customer → deliveredVia []", async () => {
  const r = rig();
  try {
    assertEquals((await signFor(r)).deliveredVia, []);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-556 (M7) signing: the confirmation email was delivered → deliveredVia ['email'] (plus 'text' for a real number)", async () => {
  const r = rig();
  try {
    assertEquals(
      (await signFor(r, { name: "Di Mail", email: "di@example.com" }))
        .deliveredVia,
      ["email"],
    );
  } finally {
    await resetKv();
  }
  const both = rig();
  try {
    assertEquals(
      (await signFor(both, {
        name: "Di Both",
        email: "di@example.com",
        phoneNumber: "(512) 555-1234",
      })).deliveredVia,
      ["email", "text"],
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-556 (M7) signing: the email bounced, the text reached a real number → deliveredVia ['text']; both failed → []", async () => {
  const r = rig({ ok: false, reason: "bounced" });
  try {
    assertEquals(
      (await signFor(r, {
        name: "Cy Real",
        email: "cy@example.com",
        phoneNumber: "(512) 555-1234",
      })).deliveredVia,
      ["text"],
    );
  } finally {
    await resetKv();
  }
  const none = rig({ ok: false, reason: "bounced" }, {
    ok: false,
    reason: "sms.notMobile",
    code: 21614,
  });
  try {
    assertEquals(
      (await signFor(none, {
        name: "Bo Landline",
        email: "bo@example.com",
        phoneNumber: "(512) 555-1234",
      })).deliveredVia,
      [],
    );
  } finally {
    await resetKv();
  }
});
