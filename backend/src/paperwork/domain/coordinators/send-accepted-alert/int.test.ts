import { assert, assertEquals } from "#std/assert";
import { SendAcceptedAlert } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import type { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

/**
 * REQ-746 — demo-loop cycle 5, issue c1-p15-18. The quote IS the agreement:
 * when the customer accepts, they have signed it (and the accept bills it).
 * The owner's alert used to say "Next step: send the agreement or invoice".
 * The real email + text the owner receives must no longer ask that, and must
 * say the quote is signed, in the owner's language.
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
  const commsLog = {
    run: () => Promise.resolve(undefined),
  } as unknown as LogPaperworkMessage;
  const alert = new SendAcceptedAlert(
    quotes,
    customers,
    users,
    email,
    sms,
    commsLog,
  );
  return { quotes, customers, users, alert, emails, texts };
}

for (
  const [lang, sendAgreement, signed] of [
    ["en", /send the agreement/i, /sign/i],
    ["es", /env[ií]a el (contrato|acuerdo)/i, /firm/i],
  ] as const
) {
  Deno.test(`REQ-746 (cycle 5, c1-p15-18) ${lang}: the accepted alert says signed, never "send the agreement"`, async () => {
    Deno.env.set("KV_PATH", ":memory:");
    await resetKv();
    const ctx = fresh();
    const contractor = await ctx.users.create({
      phoneNumber: "+15125556910",
    });
    await ctx.users.update(contractor.id, {
      email: "hans@example.com",
      language: lang,
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

    const res = await ctx.alert.run(quote.id);
    assert(res.ok);
    assertEquals(ctx.emails.length, 1);
    assertEquals(ctx.texts.length, 1);
    const html = ctx.emails[0].htmlBody ?? "";
    const text = ctx.texts[0].body;
    assert(
      !sendAgreement.test(html),
      `email asks to send the agreement:\n${html}`,
    );
    assert(
      !sendAgreement.test(text),
      `text asks to send the agreement:\n${text}`,
    );
    assert(signed.test(html), `email does not say signed:\n${html}`);
    assert(signed.test(text), `text does not say signed:\n${text}`);
  });
}
