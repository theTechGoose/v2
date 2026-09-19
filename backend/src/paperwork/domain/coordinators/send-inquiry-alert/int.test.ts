import { assert, assertEquals } from "#std/assert";
import { SendInquiryAlert } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import {
  LogPaperworkMessage,
  type LogPaperworkMessageInput,
} from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

/**
 * REQ-031 — 7.3 NW-26 (p17): "From the emailed link I filled in the 'Ask a
 * question' box … but I never received the question. Where does it go?"
 *
 * It went into one notification row no shipped UI displayed in full, and
 * `contactBack` was dropped. SendInquiryAlert (modelled on SendAcceptedAlert)
 * emails AND texts the contractor the full question plus how to reach the
 * customer back, both logged in the comms trail.
 */

function fresh() {
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const users = new UserStore();
  const email = new EmailService();
  const emails: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    emails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const sms = new SmsService();
  const texts: SendSmsInput[] = [];
  sms.send = (input: SendSmsInput) => {
    texts.push(input);
    return Promise.resolve({ ok: true });
  };
  const logged: LogPaperworkMessageInput[] = [];
  const commsLog = {
    run: (input: LogPaperworkMessageInput) => {
      logged.push(input);
      return Promise.resolve(undefined);
    },
  } as unknown as LogPaperworkMessage;
  const alert = new SendInquiryAlert(
    quotes,
    customers,
    users,
    email,
    sms,
    commsLog,
  );
  return { quotes, customers, users, alert, emails, texts, logged };
}

async function seed(ctx: ReturnType<typeof fresh>, language: "en" | "es") {
  const contractor = await ctx.users.create({ phoneNumber: "+15125556900" });
  await ctx.users.update(contractor.id, {
    email: "hans@example.com",
    language,
  });
  const customer = await ctx.customers.create(contractor.id, {
    name: "María Nguyen",
    email: "maria@example.com",
  });
  const quote = await ctx.quotes.create(contractor.id, {
    customerId: customer.id,
    summary: "Backyard junk removal",
    jobName: "Backyard Junk Removal",
    lineItems: [],
  });
  return { contractor, customer, quote };
}

const QUESTION = "Does the price include haul-away of the old fence panels?";

Deno.test("REQ-031 NW-26 the contractor gets the full question + contactBack by email and text, both logged", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { quote } = await seed(ctx, "en");

  const res = await ctx.alert.run(quote.id, {
    question: QUESTION,
    contactBack: "(512) 555-6301 after 5pm",
    name: "María",
  });
  assertEquals(res.ok, true);

  assertEquals(ctx.emails.length, 1);
  assertEquals(ctx.emails[0].to, "hans@example.com");
  assert(ctx.emails[0].subject.includes("María"), ctx.emails[0].subject);
  assert(ctx.emails[0].subject.includes("Backyard Junk Removal"), ctx.emails[0].subject);
  assert(ctx.emails[0].htmlBody.includes(QUESTION), "email body carries the full question");
  assert(ctx.emails[0].htmlBody.includes("(512) 555-6301 after 5pm"), "email body carries contactBack");

  assertEquals(ctx.texts.length, 1);
  assertEquals(ctx.texts[0].to, "+15125556900");
  assert(ctx.texts[0].body.includes(QUESTION), ctx.texts[0].body);
  assert(ctx.texts[0].body.includes("(512) 555-6301 after 5pm"), ctx.texts[0].body);

  assertEquals(ctx.logged.map((l) => l.channel).sort(), ["email", "text"]);
  for (const l of ctx.logged) {
    assert(l.content.includes(QUESTION), `comms trail carries the question: ${l.content}`);
    assertEquals(l.userId, quote.userId);
  }
  await resetKv();
});

Deno.test("REQ-031 NW-26 copy renders in the contractor's language (es)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { quote } = await seed(ctx, "es");
  await ctx.alert.run(quote.id, { question: QUESTION, name: "María" });
  assert(/pregunt/i.test(ctx.emails[0].subject), ctx.emails[0].subject);
  assert(/pregunt/i.test(ctx.texts[0].body), ctx.texts[0].body);
  await resetKv();
});

Deno.test("REQ-031 NW-26 both channels fail → ok:false, nothing logged as delivered", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { quote } = await seed(ctx, "en");
  const email = (ctx.alert as unknown as { email: EmailService }).email;
  email.send = () => Promise.resolve({ ok: false, reason: "postmark 422" });
  const sms = (ctx.alert as unknown as { sms: SmsService }).sms;
  sms.send = () => Promise.resolve({ ok: false, reason: "sms.invalidNumber" });
  const res = await ctx.alert.run(quote.id, { question: QUESTION });
  assertEquals(res.ok, false);
  assertEquals(ctx.logged.length, 0);
  await resetKv();
});
