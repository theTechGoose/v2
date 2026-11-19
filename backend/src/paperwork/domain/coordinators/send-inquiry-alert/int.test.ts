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

Deno.test("REQ-701 M21 the alert's link opens the quote's questions (/quotes?open=<id>#questions), by email and by text", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { quote } = await seed(ctx, "es");
  await ctx.alert.run(quote.id, { question: QUESTION, name: "María" });
  const link = `/quotes?open=${quote.id}#questions`;
  assert(ctx.texts[0].body.includes(link), ctx.texts[0].body);
  assert(ctx.emails[0].htmlBody.includes(link), "the email's button");
  await resetKv();
});

/**
 * REQ-947 (LOOP-007 q1, q1-23) — "'Customer asked a question' email says
 * 'Reply directly to the customer' but gives no way to" reach them. Jose left
 * "how to reach you" empty; his email + phone are on the quote's customer
 * record, yet the alert carried neither, had no Reply-To, and still told the
 * owner to "Reply directly to the customer".
 */
async function seedJose(ctx: ReturnType<typeof fresh>, language: "en" | "es") {
  const contractor = await ctx.users.create({ phoneNumber: "+15125556901" });
  await ctx.users.update(contractor.id, {
    email: "hans@example.com",
    language,
  });
  const customer = await ctx.customers.create(contractor.id, {
    name: "Jose Martinez",
    email: "jose.m@example.com",
    phoneNumber: "(512) 555-0147",
  });
  const quote = await ctx.quotes.create(contractor.id, {
    customerId: customer.id,
    summary: "Garage cleanout",
    jobName: "Garage Cleanout",
    lineItems: [],
  });
  return { contractor, customer, quote };
}

const JOSE_Q = "Can you come Saturday morning instead?";
const PHONE_SHAPES = /555-0147|5550147|\(512\) 555-0147/;

Deno.test("REQ-947 q1-23 no contactBack: the alert email carries the customer's email + phone on file and Reply-To the customer", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { quote } = await seedJose(ctx, "en");
  const res = await ctx.alert.run(quote.id, { question: JOSE_Q, name: "Jose" });
  assertEquals(res.ok, true);
  assertEquals(ctx.emails.length, 1);
  const mail = ctx.emails[0];
  assert(
    mail.htmlBody.includes("jose.m@example.com"),
    "REQ-947: the email body names the customer's email on file",
  );
  assert(
    PHONE_SHAPES.test(mail.htmlBody),
    "REQ-947: the email body names the customer's phone on file",
  );
  assert(
    mail.htmlBody.includes("mailto:jose.m@example.com"),
    "REQ-947: the email is a mailto: link",
  );
  assert(
    /tel:\+?1?5125550147/.test(mail.htmlBody),
    "REQ-947: the phone is a tel: link",
  );
  assert(
    typeof mail.replyTo === "string" && mail.replyTo.trim() !== "",
    `REQ-947: the alert sets a Reply-To (got ${JSON.stringify(mail.replyTo)})`,
  );
  assert(
    !/hello@documonster\.com/i.test(mail.replyTo ?? ""),
    "REQ-947: Reply-To is not the house From",
  );
  assert(
    mail.replyTo === "jose.m@example.com" || /^reply\+/.test(mail.replyTo ?? ""),
    `REQ-947: Reply-To reaches the customer (their address or a reply+ token), got ${mail.replyTo}`,
  );
  await resetKv();
});

Deno.test("REQ-947 q1-23 no contactBack: the alert text carries a way to reach the customer", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { quote } = await seedJose(ctx, "en");
  await ctx.alert.run(quote.id, { question: JOSE_Q, name: "Jose" });
  assertEquals(ctx.texts.length, 1);
  const body = ctx.texts[0].body;
  assert(
    PHONE_SHAPES.test(body) || /5125550147/.test(body) ||
      body.includes("jose.m@example.com"),
    `REQ-947: the SMS names the customer's phone or email on file: ${body}`,
  );
  await resetKv();
});

Deno.test("REQ-947 q1-23 the alert copy no longer says 'Reply directly to the customer' (en) / 'Respóndele directamente' (es)", async () => {
  for (const lang of ["en", "es"] as const) {
    Deno.env.set("KV_PATH", ":memory:");
    await resetKv();
    const ctx = fresh();
    const { quote } = await seedJose(ctx, lang);
    await ctx.alert.run(quote.id, { question: JOSE_Q, name: "Jose" });
    const html = ctx.emails[0].htmlBody;
    assert(
      !/Reply directly to the customer/i.test(html),
      `REQ-947 (${lang}): stale REQ-031 copy "Reply directly to the customer"`,
    );
    assert(
      !/Respóndele directamente al cliente/i.test(html),
      `REQ-947 (${lang}): stale REQ-031 copy "Respóndele directamente al cliente"`,
    );
    await resetKv();
  }
});

Deno.test("REQ-947 q1-23 a typed email in contactBack is the Reply-To (it wins over the one on file)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  const { quote } = await seedJose(ctx, "en");
  await ctx.alert.run(quote.id, {
    question: JOSE_Q,
    name: "Jose",
    contactBack: "jose.work@example.com",
  });
  const mail = ctx.emails[0];
  assert(
    mail.replyTo === "jose.work@example.com" ||
      /^reply\+/.test(mail.replyTo ?? ""),
    `REQ-947: Reply-To is the typed address (or a reply+ token), got ${mail.replyTo}`,
  );
  assert(
    mail.htmlBody.includes("(512) 555-0147") || /tel:\+?1?5125550147/.test(mail.htmlBody),
    "REQ-947: the phone on file fills the channel the customer did not type",
  );
  await resetKv();
});
