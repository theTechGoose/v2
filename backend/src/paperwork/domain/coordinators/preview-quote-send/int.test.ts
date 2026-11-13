/**
 * REQ-461 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3, issue m8: the send dialog showed no preview of
 * the email/SMS the client gets and no send-language choice. PreviewQuoteSend
 * renders the SAME subject / email body / text the send coordinators would
 * dispatch, in the picked language, without sending, publishing or logging
 * anything.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#std/assert";
import { PreviewQuoteSend } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import {
  QuoteTranslatorPort,
  type TranslateQuoteRequest,
} from "@paperwork/domain/coordinators/quote-translator-port/mod.ts";

function fresh(translator?: QuoteTranslatorPort) {
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const shortlinks = new ShortLinkStore();
  const identity = new BusinessIdentityStore();
  const flow = new PreviewQuoteSend(
    quotes,
    customers,
    new UserStore(),
    identity,
    shortlinks,
    translator,
  );
  return { flow, quotes, customers, shortlinks, identity };
}

async function seedContractor(userId: string, name = "Rosa Diaz") {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550000",
    name,
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedQuote(ctx: ReturnType<typeof fresh>, userId = "u-1") {
  const customer = await ctx.customers.create(userId, {
    name: "Juan Perez",
    email: "juan@example.com",
    phoneNumber: "+15125551234",
  });
  const quote = await ctx.quotes.create(
    userId,
    {
      customerId: customer.id,
      summary: "Paint the bathroom",
      jobName: "Bathroom paint",
      jobNameByLang: { en: "Bathroom paint", es: "Pintura del baño" },
      lineItems: [{
        description: "Paint",
        quantity: 1,
        unit: "ea",
        price: 50000,
      }],
      estimatedTotal: 50000,
    } as Parameters<QuoteStore["create"]>[1],
  );
  return { customer, quote };
}

Deno.test("REQ-461 (m8) preview-quote-send: Spanish preview renders the Spanish subject, email body and text with the ?lang=es link", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedContractor("u-1");
  await ctx.identity.upsert("u-1", { businessName: "Diaz Painting" });
  const { quote } = await seedQuote(ctx);

  const p = await ctx.flow.run("u-1", {
    quoteId: quote.id,
    channel: "both",
    lang: "es",
  });
  assertEquals(p.lang, "es");
  assert(p.email, "email preview present");
  assert(p.sms, "sms preview present");
  assert(p.email.subject.startsWith("Cotización"), p.email.subject);
  assertStringIncludes(p.email.subject, "Diaz Painting");
  assertStringIncludes(p.email.subject, "Pintura del baño");
  assertEquals(p.email.to, "juan@example.com");
  assertStringIncludes(p.email.html, "<html");
  assertStringIncludes(p.sms.body, "Pintura del baño");
  assertStringIncludes(p.sms.body, "?lang=es");
  assertStringIncludes(p.sms.body, "Juan");
  assertEquals(p.sms.to, "+15125551234");
  await resetKv();
});

Deno.test("REQ-461 (m8) preview-quote-send: English preview renders English copy; the channel picks the sections", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedContractor("u-1");
  const { quote } = await seedQuote(ctx);

  const sms = await ctx.flow.run("u-1", {
    quoteId: quote.id,
    channel: "sms",
    lang: "en",
  });
  assertEquals(sms.email, undefined);
  assert(sms.sms);
  assertStringIncludes(sms.sms.body, "Bathroom paint");
  assertStringIncludes(sms.sms.body, "?lang=en");

  const email = await ctx.flow.run("u-1", {
    quoteId: quote.id,
    channel: "email",
    lang: "en",
  });
  assertEquals(email.sms, undefined);
  assert(email.email);
  assert(email.email.subject.startsWith("Quote"), email.email.subject);
  await resetKv();
});

Deno.test("REQ-461 (m8) preview-quote-send: previewing sends nothing, publishes nothing, stamps nothing, adopts no default language", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedContractor("u-1");
  const { quote } = await seedQuote(ctx);
  // An issued quote with a pending edit: the preview shows what the send
  // would publish, but the stored quote keeps its pending revision.
  await ctx.quotes.update(quote.id, "u-1", {
    status: "sent",
    sentAt: new Date().toISOString(),
  });
  await ctx.quotes.setPending(quote.id, "u-1", {
    jobName: "Bathroom paint and trim",
    jobNameByLang: { en: "Bathroom paint and trim" },
  });
  const before = await ctx.quotes.getOwned(quote.id, "u-1");

  const p = await ctx.flow.run("u-1", {
    quoteId: quote.id,
    channel: "both",
    lang: "en",
  });
  assertStringIncludes(p.sms!.body, "Bathroom paint and trim");
  assertStringIncludes(p.email!.subject, "Bathroom paint and trim");

  const after = await ctx.quotes.getOwned(quote.id, "u-1");
  assertEquals(after.version, before.version, "no version published");
  assert(after.pendingRevision, "pending revision kept");
  assertEquals(after.lastDelivery, undefined, "no delivery recorded");
  assertEquals(after.status, "sent");
  assertEquals(
    (await ctx.identity.get("u-1"))?.commsLanguage,
    undefined,
    "a preview pick is not adopted as the default",
  );
  await resetKv();
});

Deno.test("REQ-461 (m8) preview-quote-send: another user's quote is refused; no sender name flags needsName", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedContractor("u-1");
  await seedContractor("u-2", "Nuevo usuario");
  const { quote } = await seedQuote(ctx);
  await assertRejects(() =>
    ctx.flow.run("u-2", { quoteId: quote.id, channel: "both", lang: "en" })
  );

  const mine = await seedQuote(ctx, "u-2");
  const p = await ctx.flow.run("u-2", {
    quoteId: mine.quote.id,
    channel: "both",
    lang: "en",
  });
  assertEquals(p.needsName, true);
  assertEquals(p.email, undefined);
  assertEquals(p.sms, undefined);
  await resetKv();
});

// REQ-591 (demo-loop cycle 4, M32): the English email preview of a
// Spanish-drafted quote had an English subject ("Faucet Repair") but a
// Spanish hero ("Reparación De Grifo Y Puertas Interiores").
async function seedSpanishDraft(
  ctx: ReturnType<typeof fresh>,
  heading: Record<string, unknown>,
) {
  const customer = await ctx.customers.create("u-1", {
    name: "Carmen Ruiz",
    email: "carmen@example.com",
  });
  return await ctx.quotes.create(
    "u-1",
    {
      customerId: customer.id,
      lang: "es",
      summary: "Reparación de grifo y puertas interiores",
      jobName: "Reparación de grifo",
      lineItems: [{
        description: "Cambiar grifo",
        descriptionByLang: { es: "Cambiar grifo", en: "Replace faucet" },
        quantity: 1,
        unit: "ea",
        price: 30000,
      }],
      estimatedTotal: 30000,
      ...heading,
    } as Parameters<QuoteStore["create"]>[1],
  );
}

const SPANISH_HERO = /Reparaci[oó]n|Grifo|Puertas Interiores/i;

Deno.test("REQ-591 (cycle 4, M32) preview-quote-send: an English preview of a Spanish-drafted quote has no Spanish hero", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedContractor("u-1", "Luis Ortega");
  await ctx.identity.upsert("u-1", { businessName: "Ortega Handyman" });
  const quote = await seedSpanishDraft(ctx, {
    jobNameByLang: { es: "Reparación de grifo", en: "Faucet Repair" },
  });

  const p = await ctx.flow.run("u-1", {
    quoteId: quote.id,
    channel: "email",
    lang: "en",
  });
  assert(p.email);
  assertStringIncludes(p.email.subject, "Faucet Repair");
  assertStringIncludes(p.email.html, "Faucet Repair");
  assert(
    !SPANISH_HERO.test(p.email.html),
    `Spanish heading in the English email: ${
      p.email.html.match(SPANISH_HERO)?.[0]
    }`,
  );

  // With an English summary cached, the hero is that summary.
  await ctx.quotes.update(
    quote.id,
    "u-1",
    {
      summaryByLang: {
        es: "Reparación de grifo y puertas interiores",
        en: "Faucet and interior door repair",
      },
    } as Parameters<QuoteStore["update"]>[2],
  );
  const p2 = await ctx.flow.run("u-1", {
    quoteId: quote.id,
    channel: "email",
    lang: "en",
  });
  assertStringIncludes(p2.email!.html, "Faucet And Interior Door Repair");
  assert(!SPANISH_HERO.test(p2.email!.html), "no Spanish hero");

  // The Spanish preview still leads with the typed Spanish summary — in
  // sentence case (REQ-720: a Spanish email hero is never Title Case).
  const es = await ctx.flow.run("u-1", {
    quoteId: quote.id,
    channel: "email",
    lang: "es",
  });
  assertStringIncludes(
    es.email!.html,
    "Reparación de grifo y puertas interiores",
  );
  await resetKv();
});

Deno.test("REQ-591 (cycle 4, M32) preview-quote-send: a quote with no heading in the picked language is translated before the preview renders", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const port = new QuoteTranslatorPort();
  const ctx = fresh(port);
  const calls: TranslateQuoteRequest[] = [];
  port.register(async (req) => {
    calls.push(req);
    await ctx.quotes.update(
      req.quoteId,
      req.userId,
      {
        jobNameByLang: { es: "Reparación de grifo", en: "Faucet Repair" },
        summaryByLang: {
          es: "Reparación de grifo y puertas interiores",
          en: "Faucet and interior door repair",
        },
      } as Parameters<QuoteStore["update"]>[2],
    );
  });
  await seedContractor("u-1", "Luis Ortega");
  const quote = await seedSpanishDraft(ctx, {});

  const p = await ctx.flow.run("u-1", {
    quoteId: quote.id,
    channel: "email",
    lang: "en",
  });
  assertEquals(calls.length, 1, "translated once before rendering");
  assertEquals(calls[0].langs, ["en"]);
  assertStringIncludes(p.email!.subject, "Faucet Repair");
  assertStringIncludes(p.email!.html, "Faucet And Interior Door Repair");
  assert(!SPANISH_HERO.test(p.email!.html), "no Spanish hero");

  // Everything cached now: a second preview does not call the model again.
  await ctx.flow.run("u-1", {
    quoteId: quote.id,
    channel: "email",
    lang: "en",
  });
  assertEquals(calls.length, 1, "no translation when nothing is missing");
  await resetKv();
});

// REQ-682 (demo-loop cycle 5, m28): the "What they'll get" email preview
// shares the send's step builder — the start-day step mentions a text only
// when this send texts a textable number, and a set start is stated.
Deno.test("REQ-682 (m28) preview-quote-send: 'what happens next' follows the channel and the quote's start", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedContractor("u-1");
  const { quote } = await seedQuote(ctx);

  const emailOnly = await ctx.flow.run("u-1", {
    quoteId: quote.id,
    channel: "email",
    lang: "en",
  });
  const eh = emailOnly.email!.html;
  assert(/We(?:&#39;|')ll confirm a start day/.test(eh), "no start set yet");
  assert(
    !/Pick a start day|We(?:&#39;|')ll text/.test(eh),
    "email-only promises no text",
  );

  const both = await ctx.flow.run("u-1", {
    quoteId: quote.id,
    channel: "both",
    lang: "en",
  });
  assert(
    /We(?:&#39;|')ll text you/.test(both.email!.html),
    "a texted send says so",
  );

  await ctx.quotes.update(quote.id, "u-1", { startDate: "2026-11-20" });
  const started = await ctx.flow.run("u-1", {
    quoteId: quote.id,
    channel: "both",
    lang: "en",
  });
  assertStringIncludes(started.email!.html, "Work starts Nov 20, 2026");
  assert(
    !/We(?:&#39;|')ll text/.test(started.email!.html),
    "a set start needs no text",
  );
  await resetKv();
});
