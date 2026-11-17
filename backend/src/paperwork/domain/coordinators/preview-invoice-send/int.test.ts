/**
 * REQ-727 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue c4-M16 / m56: on /invoices
 * "Issue invoice", "Finish + send" and "Send now" sent the invoice at once —
 * no channel choice, no preview, no confirm. The send sheet's "What they'll
 * get" is PreviewInvoiceSend: the SAME subject, email and text the send
 * coordinators dispatch, in the invoice's own language unless another is
 * picked, with the dates the send will stamp — and it sends, issues,
 * publishes and adopts nothing.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#std/assert";
import { PreviewInvoiceSend } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

function fresh() {
  const invoices = new InvoiceStore();
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const identity = new BusinessIdentityStore();
  const flow = new PreviewInvoiceSend(
    invoices,
    quotes,
    customers,
    new UserStore(),
    identity,
    new ShortLinkStore(),
  );
  return { flow, invoices, quotes, customers, identity };
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

async function seedInvoice(
  ctx: ReturnType<typeof fresh>,
  extra: Record<string, unknown> = {},
  userId = "u-1",
): Promise<Invoice> {
  const customer = await ctx.customers.create(userId, {
    name: "Juan Perez",
    email: "juan@example.com",
    phoneNumber: "+15125551234",
  });
  return await ctx.invoices.create(
    userId,
    {
      customerId: customer.id,
      jobName: "Pintura del baño",
      amount: 50000,
      status: "draft",
      dueDate: "2026-12-12",
      ...extra,
    } as unknown as Parameters<InvoiceStore["create"]>[1],
  );
}

async function fresh_kv() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
}

Deno.test("REQ-727 (c4-M16) preview-invoice-send: with no pick it previews in the invoice's own language — a Spanish-typed invoice gets the Spanish subject, email and text, and its links carry ?lang=es", async () => {
  await fresh_kv();
  const ctx = fresh();
  await seedContractor("u-1");
  await ctx.identity.upsert("u-1", { businessName: "Diaz Painting" });
  const inv = await seedInvoice(ctx, { lang: "es" });

  const p = await ctx.flow.run("u-1", { invoiceId: inv.id, channel: "both" });
  assertEquals(p.lang, "es", "the invoice's own language, not the default en");
  assert(p.email, "the email part is there");
  assert(p.sms, "the text part is there");
  assert(
    p.email.subject.startsWith(`Factura ${inv.number} de Diaz Painting`),
    p.email.subject,
  );
  assertEquals(p.email.to, "juan@example.com");
  assertStringIncludes(p.email.html, "<html");
  assertStringIncludes(
    p.email.html,
    `/i/${inv.id}?lang=es`,
    "the email's button opens /i in the language it was sent in",
  );
  assertStringIncludes(p.sms.body, "Hola Juan, tu factura está lista ($500)");
  assertStringIncludes(p.sms.body, "?lang=es");
  assertEquals(p.sms.to, "+15125551234");
  await resetKv();
});

Deno.test("REQ-727 (c4-M16) preview-invoice-send: a picked language wins, and the channel decides which parts are rendered", async () => {
  await fresh_kv();
  const ctx = fresh();
  await seedContractor("u-1");
  const inv = await seedInvoice(ctx, { lang: "es" });

  const en = await ctx.flow.run("u-1", {
    invoiceId: inv.id,
    channel: "both",
    lang: "en",
  });
  assertEquals(en.lang, "en");
  assert(
    en.email!.subject.startsWith(`Invoice ${inv.number}`),
    en.email!.subject,
  );
  assertStringIncludes(en.email!.html, `/i/${inv.id}?lang=en`);
  assertStringIncludes(en.sms!.body, "your invoice is ready ($500)");
  assertStringIncludes(en.sms!.body, "?lang=en");

  const sms = await ctx.flow.run("u-1", {
    invoiceId: inv.id,
    channel: "sms",
    lang: "en",
  });
  assertEquals(sms.email, undefined, "a text-only send has no email part");
  assert(sms.sms, "…and has its text");
  const email = await ctx.flow.run("u-1", {
    invoiceId: inv.id,
    channel: "email",
    lang: "en",
  });
  assertEquals(email.sms, undefined, "an email-only send has no text part");
  assert(email.email, "…and has its email");
  await resetKv();
});

Deno.test("REQ-727 (c4-M16) preview-invoice-send: a quote-linked invoice previews in the language its quote went out in; with no document language, the Settings default; with nothing, English", async () => {
  await fresh_kv();
  const ctx = fresh();
  await seedContractor("u-1");
  const quote = await ctx.quotes.create(
    "u-1",
    {
      summary: "Paint",
      jobName: "Bathroom paint",
      lineItems: [{ description: "Paint", quantity: 1, price: 50000 }],
      estimatedTotal: 50000,
    } as Parameters<QuoteStore["create"]>[1],
  );
  await ctx.quotes.update(
    quote.id,
    "u-1",
    {
      lastDelivery: {
        at: new Date().toISOString(),
        channel: "email",
        emailedTo: "juan@example.com",
        lang: "es",
      },
    } as unknown as Parameters<QuoteStore["update"]>[2],
  );
  const linked = await seedInvoice(ctx, { quoteId: quote.id });
  const p = await ctx.flow.run("u-1", {
    invoiceId: linked.id,
    channel: "both",
  });
  assertEquals(p.lang, "es", "the quote went out in Spanish");

  const standalone = await seedInvoice(ctx);
  assertEquals(
    (await ctx.flow.run("u-1", { invoiceId: standalone.id, channel: "sms" }))
      .lang,
    "en",
    "nothing anywhere → English",
  );
  await ctx.identity.upsert("u-1", { commsLanguage: "es" });
  assertEquals(
    (await ctx.flow.run("u-1", { invoiceId: standalone.id, channel: "sms" }))
      .lang,
    "es",
    "no document language → the Settings default",
  );
  await resetKv();
});

Deno.test("REQ-727 (c4-M16) preview-invoice-send: it reads as the send will (issued, with the send's dates, the pending edit applied) — and sends, issues, publishes and adopts nothing", async () => {
  await fresh_kv();
  const ctx = fresh();
  await seedContractor("u-1");
  const draft = await seedInvoice(ctx);

  const p = await ctx.flow.run("u-1", {
    invoiceId: draft.id,
    channel: "both",
    lang: "es",
    issuedDate: "2026-11-12",
    dueDate: "2026-11-27",
  });
  assertStringIncludes(
    p.email!.subject,
    "vence 27 de noviembre de 2026",
    "the subject carries the due date the send will stamp",
  );
  assertStringIncludes(p.email!.html, ">Enviado<", "the draft reads as issued");
  assert(!p.email!.html.includes(">Borrador<"), "never 'Draft' in the email");
  const after = await ctx.invoices.getOwned(draft.id, "u-1");
  assertEquals(after.status, "draft", "nothing was issued");
  assertEquals(after.sentAt, undefined, "no sentAt");
  assertEquals(after.dueDate, "2026-12-12", "the stored dates are untouched");
  assertEquals(after.issuedDate, undefined);
  assertEquals(
    (await ctx.identity.get("u-1"))?.commsLanguage,
    undefined,
    "a preview's language is not adopted as the default",
  );

  // An issued invoice with a pending edit: the preview shows what the send
  // would publish; the stored invoice keeps its pending revision.
  const sent = await seedInvoice(ctx, {
    status: "sent",
    sentAt: new Date().toISOString(),
    jobName: "Fence repair",
  });
  await ctx.invoices.setPending(sent.id, "u-1", { amount: 72500 });
  const before = await ctx.invoices.getOwned(sent.id, "u-1");
  const rev = await ctx.flow.run("u-1", {
    invoiceId: sent.id,
    channel: "sms",
    lang: "en",
  });
  assertStringIncludes(rev.sms!.body, "($725)", "the pending amount shows");
  const kept = await ctx.invoices.getOwned(sent.id, "u-1");
  assertEquals(kept.version, before.version, "no version published");
  assert(kept.pendingRevision, "the pending revision is kept");
  assertEquals(kept.amount, 50000);
  await resetKv();
});

Deno.test("REQ-727 (c4-M16) preview-invoice-send: another user's invoice is refused; an account with no name to sign with gets needsName and no parts", async () => {
  await fresh_kv();
  const ctx = fresh();
  await seedContractor("u-1");
  await seedContractor("u-2", "Nuevo usuario");
  const inv = await seedInvoice(ctx);
  await assertRejects(() =>
    ctx.flow.run("u-2", { invoiceId: inv.id, channel: "both", lang: "en" })
  );

  const mine = await seedInvoice(ctx, {}, "u-2");
  const p = await ctx.flow.run("u-2", {
    invoiceId: mine.id,
    channel: "both",
    lang: "en",
  });
  assertEquals(p.needsName, true);
  assertEquals(p.email, undefined);
  assertEquals(p.sms, undefined);
  await resetKv();
});
