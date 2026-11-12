/**
 * REQ-342 (demo-loop cycle 1, M13): the SMS shortlink carries the send
 * language — `/s/<code>?lang=es` — so a cookie-less customer who taps it
 * lands on /q in the language the quote was sent in. The resolved code still
 * names the quote; /s/:code forwards the query onto /q.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { SendPaperworkSms } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const sms = new SmsService();
  const sent: SendSmsInput[] = [];
  sms.send = (input: SendSmsInput) => {
    sent.push(input);
    return Promise.resolve({ ok: true, sid: "SM-test" });
  };
  const shortlinks = new ShortLinkStore();
  const flow = new SendPaperworkSms(
    quotes,
    new InvoiceStore(),
    customers,
    new UserStore(),
    new BusinessIdentityStore(),
    sms,
    shortlinks,
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    ),
  );
  return { flow, quotes, customers, shortlinks, sent };
}

async function seedContractor(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550000",
    name: "Test Contractor",
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  });
}

Deno.test("REQ-342 send-paperwork-sms: a Spanish send's text carries /s/<code>?lang=es, and the code resolves to the quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, quotes, customers, shortlinks, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", {
    name: "Juan",
    phoneNumber: "+15125551234",
  });
  const quote = await quotes.create("u-1", {
    customerId: customer.id,
    summary: "Pintar el baño",
    lineItems: [{
      description: "Pintura",
      quantity: 1,
      unit: "ea",
      price: 500,
    }],
    estimatedTotal: 500,
  });

  const r = await flow.run("u-1", {
    kind: "quote",
    resourceId: quote.id,
    language: "es",
  });
  assertEquals(r.ok, true, r.reason);
  assertEquals(sent.length, 1);
  const link = await shortlinks.findOrCreate("u-1", "quote", quote.id);
  assertStringIncludes(sent[0].body, `/s/${link.code}?lang=es`);
  const resolved = await shortlinks.get(link.code);
  assertEquals(resolved.kind, "quote");
  assertEquals(resolved.id, quote.id);
  await resetKv();
});

Deno.test("REQ-342 send-paperwork-sms: a send with no pick carries the resolved default, /s/<code>?lang=en", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, quotes, customers, shortlinks, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", {
    name: "Ann",
    phoneNumber: "+15125551234",
  });
  const quote = await quotes.create("u-1", {
    customerId: customer.id,
    summary: "Roof",
    lineItems: [{ description: "Demo", quantity: 1, unit: "ea", price: 500 }],
    estimatedTotal: 500,
  });
  const r = await flow.run("u-1", { kind: "quote", resourceId: quote.id });
  assertEquals(r.ok, true, r.reason);
  const link = await shortlinks.findOrCreate("u-1", "quote", quote.id);
  // UX-28: the coordinator always resolves ONE send language (pick → stored
  // default → en); the link names what the text went out in.
  assertStringIncludes(sent[0].body, `/s/${link.code}?lang=en`);
  assert(
    !sent[0].body.includes("?lang=es"),
    "an English send never links the Spanish document",
  );
  await resetKv();
});
