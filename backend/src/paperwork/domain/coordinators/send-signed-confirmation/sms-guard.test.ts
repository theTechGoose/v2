/**
 * REQ-403 (demo-loop cycle 2, issue m11): after a failed text the app said
 * the customer was "Texted to +15125550177" and promised an SMS
 * confirmation. The completion SMS skipped the fictional/invalid guard the
 * quote send applies, so the dev fake answered ok and a "text" comms-trail
 * row (the receipts strip's "Texted to") was logged for a number that can
 * never receive a text.
 *
 * Every customer text now goes through one guarded dispatch
 * (`dispatchCustomerSms`), and a comms-trail row is logged only for a real
 * delivery.
 */
import { assertEquals } from "#std/assert";
import { SendSignedConfirmation } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import {
  type SendSmsInput,
  type SendSmsResult,
  SmsService,
} from "@users/domain/data/sms/mod.ts";
import { RenderQuotePdf } from "@paperwork/domain/coordinators/render-quote-pdf/mod.ts";
import {
  LogPaperworkMessage,
  type LogPaperworkMessageInput,
} from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function rig(answer: SendSmsResult = { ok: true, sid: "SM-test" }) {
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const email = new EmailService();
  email.send = () => Promise.resolve({ ok: true, reason: "test_capture" });
  const sms = new SmsService();
  const texts: SendSmsInput[] = [];
  sms.send = (input: SendSmsInput) => {
    texts.push(input);
    return Promise.resolve(answer);
  };
  const commsLog = new LogPaperworkMessage(
    new CommConversationStore(),
    new CommMessageStore(),
  );
  const logged: LogPaperworkMessageInput[] = [];
  commsLog.run = (input: LogPaperworkMessageInput) => {
    logged.push(input);
    return Promise.resolve(undefined);
  };
  const flow = new SendSignedConfirmation(
    quotes,
    new InvoiceStore(),
    customers,
    new UserStore(),
    new BusinessIdentityStore(),
    new RenderQuotePdf(),
    email,
    sms,
    commsLog,
  );
  return { flow, quotes, customers, texts, logged };
}

async function signedQuoteFor(
  r: ReturnType<typeof rig>,
  phoneNumber: string,
) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const customer = await r.customers.create("u-1", {
    name: "Ana Torres",
    phoneNumber,
  });
  return await r.quotes.create("u-1", {
    summary: "Fence",
    lineItems: [],
    customerId: customer.id,
    estimatedTotal: 400_00,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
}

Deno.test("REQ-403 (m11) signed confirmation: a fictional 555-01xx customer number is never texted and no 'Texted to' comms row is logged", async () => {
  const r = rig();
  try {
    const quote = await signedQuoteFor(r, "+15125550177");
    await r.flow.run(quote.id);
    assertEquals(r.texts.length, 0, "the fictional number was dialled");
    assertEquals(
      r.logged.filter((l) => l.channel === "text").length,
      0,
      "a 'text' comms-trail row was logged for a number that cannot get texts",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-403 (m11) signed confirmation: a real number is texted once and logged once", async () => {
  const r = rig();
  try {
    const quote = await signedQuoteFor(r, "(512) 555-1234");
    await r.flow.run(quote.id);
    assertEquals(r.texts.map((t) => t.to), ["+15125551234"]);
    assertEquals(r.logged.filter((l) => l.channel === "text").length, 1);
    assertEquals(r.logged[0].toAddress, "+15125551234");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-403 (m11) signed confirmation: a provider rejection logs no comms row", async () => {
  const r = rig({ ok: false, reason: "sms.invalidNumber", code: 21211 });
  try {
    const quote = await signedQuoteFor(r, "+15125551234");
    await r.flow.run(quote.id);
    assertEquals(r.texts.length, 1);
    assertEquals(r.logged.length, 0);
  } finally {
    await resetKv();
  }
});
