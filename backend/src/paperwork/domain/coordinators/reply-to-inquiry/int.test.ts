/**
 * REQ-701 (demo-loop cycle 5, issue M21) — the contractor ANSWERS a client's
 * question from the quote panel ("Text back" / "Email back").
 *
 * Pair 9: "Linda's question text is NOWHERE on that panel, no reply box. How
 * do I answer her?" ReplyToInquiry sends the answer through the same services
 * the paperwork sends use — the guarded customer text (REQ-403) and
 * EmailService with the business alias, the contractor in Cc and the
 * customer's reply-to address (REQ-175) — to the contact the client asked to
 * be reached at, else to the customer's contact on file. A delivered answer
 * is logged in the customer's comms trail (never as a quote-send receipt:
 * no paperworkId) and marks the question answered; a failed one changes
 * nothing and says why, as a code.
 */
import { assert, assertEquals, assertRejects } from "#std/assert";
import { ReplyToInquiry } from "./mod.ts";
import { QuoteInquiryStore } from "@paperwork/domain/data/inquiry-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import type {
  LogPaperworkMessage,
  LogPaperworkMessageInput,
} from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const QUESTION =
  "¿Pueden venir el sábado en la mañana? ¿Se llevan también un colchón?";
const ANSWER = "Sí, el sábado a las 9. El colchón son $40 más.";

function fresh() {
  const inquiries = new QuoteInquiryStore();
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
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
    // REQ-784: the outbox record every customer message also gets
    outbox: () => Promise.resolve(undefined),
  } as unknown as LogPaperworkMessage;
  const reply = new ReplyToInquiry(
    inquiries,
    quotes,
    customers,
    users,
    identity,
    email,
    sms,
    commsLog,
  );
  return {
    inquiries,
    quotes,
    customers,
    users,
    identity,
    email,
    sms,
    reply,
    emails,
    texts,
    logged,
  };
}

type Ctx = ReturnType<typeof fresh>;

async function seed(
  ctx: Ctx,
  opts: {
    contactBack?: string;
    customer?: { phoneNumber?: string; email?: string };
    contractorName?: string;
    businessName?: string;
  } = {},
) {
  const rosa = await ctx.users.create({ phoneNumber: "+15125559100" });
  await ctx.users.update(rosa.id, {
    name: opts.contractorName ?? "Rosa Delgado",
    email: "rosa@junkmonsters.test",
    language: "es",
  });
  if (opts.businessName !== "") {
    await ctx.identity.upsert(rosa.id, {
      businessName: opts.businessName ?? "Junk Monsters",
    });
  }
  const linda = await ctx.customers.create(rosa.id, {
    name: "Linda Morales",
    ...(opts.customer ?? {}),
  });
  const quote = await ctx.quotes.create(rosa.id, {
    customerId: linda.id,
    summary: "Retiro de muebles",
    jobName: "Retiro de muebles",
    lineItems: [],
  });
  const inquiry = await ctx.inquiries.create({
    quoteId: quote.id,
    userId: rosa.id,
    customerId: linda.id,
    question: QUESTION,
    ...(opts.contactBack ? { contactBack: opts.contactBack } : {}),
    name: "Linda Morales",
    lang: "es",
  });
  assert(inquiry);
  return { rosa, linda, quote, inquiry };
}

async function withKv(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    await fn();
  } finally {
    await resetKv();
  }
}

Deno.test("REQ-701 M21 Text back goes to the number the client asked to be reached at, signed by the contractor, logged in the customer's trail (not as a quote send) and marks the question answered", () =>
  withKv(async () => {
    const ctx = fresh();
    const { rosa, linda, quote, inquiry } = await seed(ctx, {
      contactBack: "(512) 555-6301 después de las 5",
      customer: { phoneNumber: "+15127730148", email: "linda@example.com" },
    });
    const res = await ctx.reply.run(rosa.id, {
      quoteId: quote.id,
      inquiryId: inquiry.id,
      channel: "text",
      message: `  ${ANSWER}  `,
    });
    assertEquals(res.ok, true, JSON.stringify(res));
    assertEquals(res.channel, "text");
    assertEquals(res.to, "+15125556301");

    assertEquals(ctx.texts.length, 1);
    assertEquals(ctx.texts[0].to, "+15125556301");
    assert(ctx.texts[0].body.includes(ANSWER), ctx.texts[0].body);
    assert(ctx.texts[0].body.includes("Rosa"), ctx.texts[0].body);
    assert(ctx.texts[0].body.includes("Junk Monsters"), ctx.texts[0].body);
    assertEquals(ctx.emails.length, 0);

    assertEquals(ctx.logged.length, 1);
    assertEquals(ctx.logged[0].channel, "text");
    assertEquals(ctx.logged[0].toAddress, "+15125556301");
    assertEquals(ctx.logged[0].customerId, linda.id);
    assertEquals(ctx.logged[0].userId, rosa.id);
    assertEquals(ctx.logged[0].paperworkId, undefined);
    assert(ctx.logged[0].content.includes(ANSWER), ctx.logged[0].content);

    const after = await ctx.inquiries.get(quote.id, inquiry.id);
    assertEquals(after?.answer?.channel, "text");
    assertEquals(after?.answer?.to, "+15125556301");
    assertEquals(after?.answer?.message, ANSWER);
    assertEquals(typeof after?.answeredAt, "string");
    assertEquals(res.inquiry?.answeredAt, after?.answeredAt);
  }));

Deno.test("REQ-701 M21 Email back goes to the email the client gave, in the client's language, from the business alias with the contractor in Cc and the customer's reply-to", () =>
  withKv(async () => {
    const ctx = fresh();
    const { rosa, quote, inquiry } = await seed(ctx, {
      contactBack: "Linda.Morales@Example.com",
      customer: { phoneNumber: "+15127730148" },
    });
    const res = await ctx.reply.run(rosa.id, {
      quoteId: quote.id,
      inquiryId: inquiry.id,
      channel: "email",
      message: "Sí <b>claro</b> — el sábado a las 9.",
    });
    assertEquals(res.ok, true, JSON.stringify(res));
    assertEquals(res.to, "linda.morales@example.com");
    assertEquals(ctx.emails.length, 1);
    const sent = ctx.emails[0];
    assertEquals(sent.to, "linda.morales@example.com");
    assert(/pregunta/i.test(sent.subject), sent.subject);
    assert(sent.subject.includes("Retiro de muebles"), sent.subject);
    assert(
      sent.htmlBody.includes(
        "Sí &lt;b&gt;claro&lt;/b&gt; — el sábado a las 9.",
      ),
      "the answer, escaped",
    );
    assert(sent.htmlBody.includes("¿Pueden venir el sábado"), "her question");
    assertEquals(sent.cc, ["rosa@junkmonsters.test"]);
    assert(/^reply\+[a-z0-9]+@/.test(sent.replyTo ?? ""), sent.replyTo);
    assert(sent.from?.endsWith("@documonster.com"), sent.from);
    assertEquals(ctx.texts.length, 0);
    assertEquals(ctx.logged.map((l) => [l.channel, l.toAddress]), [[
      "email",
      "linda.morales@example.com",
    ]]);
    assertEquals(ctx.logged[0].paperworkId, undefined);
    assertEquals(
      (await ctx.inquiries.get(quote.id, inquiry.id))?.answer?.channel,
      "email",
    );
  }));

Deno.test("REQ-701 M21 no contact-back value → the customer's phone and email on file", () =>
  withKv(async () => {
    const ctx = fresh();
    const { rosa, quote, inquiry } = await seed(ctx, {
      customer: { phoneNumber: "512-773-0148", email: "linda@example.com" },
    });
    const text = await ctx.reply.run(rosa.id, {
      quoteId: quote.id,
      inquiryId: inquiry.id,
      channel: "text",
      message: ANSWER,
    });
    assertEquals(text.to, "+15127730148");
    const mail = await ctx.reply.run(rosa.id, {
      quoteId: quote.id,
      inquiryId: inquiry.id,
      channel: "email",
      message: ANSWER,
    });
    assertEquals(mail.to, "linda@example.com");
    assertEquals(ctx.texts.map((t) => t.to), ["+15127730148"]);
    assertEquals(ctx.emails.map((e) => e.to), ["linda@example.com"]);
  }));

Deno.test("REQ-701 M21 a reply that can't go out changes nothing and says why: no phone, a fictional number, a refused text, a failed email, an empty message", () =>
  withKv(async () => {
    const ctx = fresh();
    const { rosa, quote, inquiry } = await seed(ctx, {
      customer: { email: "linda@example.com" },
    });
    const run = (channel: "text" | "email", message = ANSWER) =>
      ctx.reply.run(rosa.id, {
        quoteId: quote.id,
        inquiryId: inquiry.id,
        channel,
        message,
      });

    const noPhone = await run("text");
    assertEquals([noPhone.ok, noPhone.failureCode], [false, "missing"]);

    const empty = await run("email", "   ");
    assertEquals([empty.ok, empty.failureCode], [false, "empty"]);

    ctx.email.send = () =>
      Promise.resolve({ ok: false, reason: "postmark 422" });
    const failedMail = await run("email");
    assertEquals([failedMail.ok, failedMail.failureCode], [false, "other"]);

    assertEquals(ctx.texts.length, 0);
    assertEquals(ctx.logged.length, 0);
    assertEquals(
      (await ctx.inquiries.get(quote.id, inquiry.id))?.answeredAt,
      undefined,
    );
  }));

Deno.test("REQ-701 M21 a fictional or refused number: the provider is never called (fictional) / nothing is logged (refused)", () =>
  withKv(async () => {
    const ctx = fresh();
    const { rosa, quote, inquiry } = await seed(ctx, {
      contactBack: "(512) 555-0123",
    });
    const fic = await ctx.reply.run(rosa.id, {
      quoteId: quote.id,
      inquiryId: inquiry.id,
      channel: "text",
      message: ANSWER,
    });
    assertEquals([fic.ok, fic.failureCode], [false, "fictional"]);
    assertEquals(ctx.texts.length, 0);

    const other = await ctx.inquiries.create({
      quoteId: quote.id,
      userId: rosa.id,
      question: "¿Y el domingo?",
      contactBack: "512 555 6301",
    });
    assert(other);
    ctx.sms.send = () =>
      Promise.resolve({ ok: false, reason: "sms.notMobile" });
    const refused = await ctx.reply.run(rosa.id, {
      quoteId: quote.id,
      inquiryId: other.id,
      channel: "text",
      message: ANSWER,
    });
    assertEquals([refused.ok, refused.failureCode], [false, "notMobile"]);
    assertEquals(ctx.logged.length, 0);
    assertEquals(
      (await ctx.inquiries.get(quote.id, other.id))?.answeredAt,
      undefined,
    );
  }));

Deno.test("REQ-701 M21 P-06: an account without a real name or business never texts a client — needsName, nothing sent", () =>
  withKv(async () => {
    const ctx = fresh();
    const { rosa, quote, inquiry } = await seed(ctx, {
      contactBack: "(512) 555-6301",
      contractorName: "Nuevo usuario",
      businessName: "",
    });
    const res = await ctx.reply.run(rosa.id, {
      quoteId: quote.id,
      inquiryId: inquiry.id,
      channel: "text",
      message: ANSWER,
    });
    assertEquals(res.ok, false);
    assertEquals(res.failureCode, "needsName");
    assertEquals(ctx.texts.length, 0);
    assertEquals(ctx.logged.length, 0);
  }));

Deno.test("REQ-701 M21 only the quote's owner can answer, and only a question on that quote", () =>
  withKv(async () => {
    const ctx = fresh();
    const { quote, inquiry } = await seed(ctx, {
      contactBack: "(512) 555-6301",
    });
    const other = await ctx.users.create({ phoneNumber: "+15125559101" });
    await assertRejects(
      () =>
        ctx.reply.run(other.id, {
          quoteId: quote.id,
          inquiryId: inquiry.id,
          channel: "text",
          message: ANSWER,
        }),
      ForbiddenError,
    );
    await assertRejects(
      () =>
        ctx.reply.run(quote.userId, {
          quoteId: quote.id,
          inquiryId: "nope",
          channel: "text",
          message: ANSWER,
        }),
      NotFoundError,
    );
    assertEquals(ctx.texts.length, 0);
  }));
