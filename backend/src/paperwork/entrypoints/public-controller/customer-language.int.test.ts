/**
 * REQ-715 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5, issue m31 (with c4-M34: "use it … for docLang on
 * /i and /co"). A customer who reads Spanish opened /i and /co in the
 * contractor's default language: /i's document language was the invoice's
 * typed language or its quote's send language (REQ-586), /co's was the
 * contractor's commsLanguage — the customer's own language was never asked.
 *
 * Integration over HTTP, app booted: GET /invoices/:id/public names the
 * customer's language as `docLang` ahead of REQ-586's order, and
 * GET /change-orders/:id/public renders in it (`commsLanguage`). A customer
 * with no language keeps the old answers.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import type { CreateCustomerDto } from "@crm/dto/customer.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;
const USER = "u-req715-pub";

Deno.test("REQ-715 m31: /i and /co open in the customer's own language, ahead of the typed language, the quote's send language and the contractor's default", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const customers = new CustomerStore();
    const quotes = new QuoteStore();
    const invoices = new InvoiceStore();
    // the contractor's own default is English
    await new BusinessIdentityStore().upsert(USER, {
      businessName: "Ortega Handyman Services",
      commsLanguage: "en",
    });
    const carmen = await customers.create(USER, {
      name: "Carmen Ruiz",
      language: "es",
    } as CreateCustomerDto);
    const bob = await customers.create(USER, { name: "Bob Smith" });

    // A standalone invoice typed in English, billed to Carmen.
    const typedEn = await invoices.create(USER, {
      customerId: carmen.id,
      status: "sent",
      amount: 450_00,
      jobName: "Faucet repair",
    });
    await invoices.update(typedEn.id, USER, { lang: "en" });
    const pub1 = await fetch(`${BASE}/invoices/${typedEn.id}/public`)
      .then((r) => r.json());
    assertEquals(pub1.docLang, "es", "her language beats the typed language");

    // A quote-linked invoice whose quote went out in English.
    const q = await quotes.create(USER, {
      customerId: carmen.id,
      summary: "Faucet repair",
      lineItems: [],
      estimatedTotal: 450_00,
      status: "accepted",
    });
    await quotes.update(q.id, USER, {
      lastDelivery: {
        at: new Date().toISOString(),
        channel: "email",
        emailedTo: "carmen@example.com",
        lang: "en",
      },
    });
    const linked = await invoices.create(USER, {
      customerId: carmen.id,
      status: "sent",
      amount: 450_00,
      quoteId: q.id,
    });
    const pub2 = await fetch(`${BASE}/invoices/${linked.id}/public`)
      .then((r) => r.json());
    assertEquals(
      pub2.docLang,
      "es",
      "her language beats the quote's send language",
    );

    // Bob has no language: REQ-586's answer stands (the typed language).
    const bobs = await invoices.create(USER, {
      customerId: bob.id,
      status: "sent",
      amount: 90_00,
      jobName: "Gate latch",
    });
    await invoices.update(bobs.id, USER, { lang: "en" });
    const pub3 = await fetch(`${BASE}/invoices/${bobs.id}/public`)
      .then((r) => r.json());
    assertEquals(pub3.docLang, "en");

    // A change order on Carmen's invoice renders in Spanish; Bob's in the
    // contractor's English default.
    const changeOrders = new ChangeOrderStore();
    const coCarmen = await changeOrders.create(USER, linked.id, {
      description: "Second coat",
      deltaAmountCents: 120_00,
      customerId: carmen.id,
    });
    const coPub = await fetch(`${BASE}/change-orders/${coCarmen.id}/public`)
      .then((r) => r.json());
    assertEquals(coPub.commsLanguage, "es");
    const coBob = await changeOrders.create(USER, bobs.id, {
      description: "New latch",
      deltaAmountCents: 20_00,
      customerId: bob.id,
    });
    const coBobPub = await fetch(`${BASE}/change-orders/${coBob.id}/public`)
      .then((r) => r.json());
    assertEquals(coBobPub.commsLanguage, "en");
  } finally {
    await server.stop();
    await resetKv();
  }
});

// REQ-715 (m31 "as the /q,/i default when no ?lang= is given"): /q is
// English first (REQ-048) unless the visitor chose — the public quote now
// names the customer's own language as `docLang`, which the page opens in
// when the link has no ?lang= and the visitor no pm_lang pick. Read from the
// LIVE customer: the issued snapshot (REQ-204) is who they were, not the
// language they read today.
Deno.test("REQ-715 m31: /q names the customer's own language as docLang, read live; a customer with none leaves it out", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const customers = new CustomerStore();
    const quotes = new QuoteStore();
    await new BusinessIdentityStore().upsert(USER, {
      businessName: "Ortega Handyman Services",
      commsLanguage: "en",
    });
    const carmen = await customers.create(USER, {
      name: "Carmen Ruiz",
      language: "es",
    } as CreateCustomerDto);
    const bob = await customers.create(USER, { name: "Bob Smith" });
    const sentAt = new Date().toISOString();
    const hers = await quotes.create(USER, {
      customerId: carmen.id,
      summary: "Faucet repair",
      lineItems: [],
      estimatedTotal: 450_00,
      status: "sent",
      sentAt,
    });
    const read = (id: string) =>
      fetch(`${BASE}/quotes/${id}/public`).then((r) => r.json());

    assertEquals(
      (await read(hers.id)).docLang,
      "es",
      "her quote opens in Spanish",
    );

    await customers.update(carmen.id, USER, { language: "en" });
    assertEquals(
      (await read(hers.id)).docLang,
      "en",
      "the language she reads today, not the one on file when it was issued",
    );

    const his = await quotes.create(USER, {
      customerId: bob.id,
      summary: "Gate latch",
      lineItems: [],
      estimatedTotal: 90_00,
      status: "sent",
      sentAt,
    });
    const bobs = await read(his.id);
    assertEquals("docLang" in bobs, false, JSON.stringify(bobs.docLang));
  } finally {
    await server.stop();
    await resetKv();
  }
});
