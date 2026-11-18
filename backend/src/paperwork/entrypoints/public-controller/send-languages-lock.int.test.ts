/**
 * REQ-925 — Raphael, 2026-11-18: "if in settings english is only selected it
 * should not be possible to get an invoice quote or comunication that is in
 * spanish."
 *
 * Integration over HTTP, app booted: an English-only account (Settings →
 * "Languages you send in" = English, a stale "es" default left behind) bills
 * Carmen, who reads Spanish (REQ-715), on an invoice typed in Spanish. The
 * public invoice, quote and change-order projections name English as the
 * document language and hand the pages the send-in set, so /i, /q and /co
 * render English and show no EN | ES switch.
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
const USER = "u-req925-pub";

Deno.test("REQ-925: /i, /q and /co projections are English with the send-in set when Settings sends in English only", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const customers = new CustomerStore();
    const quotes = new QuoteStore();
    const invoices = new InvoiceStore();
    await new BusinessIdentityStore().upsert(USER, {
      businessName: "Ortega Handyman Services",
      commsLanguages: ["en"],
      commsLanguage: "es",
    });
    const carmen = await customers.create(USER, {
      name: "Carmen Ruiz",
      language: "es",
    } as CreateCustomerDto);

    const q = await quotes.create(USER, {
      customerId: carmen.id,
      summary: "Faucet repair",
      lineItems: [],
      estimatedTotal: 450_00,
      status: "sent",
    });
    await quotes.update(q.id, USER, {
      lastDelivery: {
        at: new Date().toISOString(),
        channel: "email",
        emailedTo: "carmen@example.com",
        lang: "es",
      },
    });
    const inv = await invoices.create(USER, {
      customerId: carmen.id,
      status: "sent",
      amount: 450_00,
      quoteId: q.id,
    });
    await invoices.update(inv.id, USER, { lang: "es" });

    const pi = await fetch(`${BASE}/invoices/${inv.id}/public`).then((r) =>
      r.json()
    );
    assertEquals(pi.docLang, "en", "/i document language");
    assertEquals(pi.contractor?.commsLanguage, "en", "/i contractor default");
    assertEquals(pi.contractor?.sendLanguages, ["en"], "/i send-in set");

    const pq = await fetch(`${BASE}/quotes/${q.id}/public`).then((r) =>
      r.json()
    );
    assertEquals(pq.docLang, "en", "/q document language");
    assertEquals(pq.contractor?.sendLanguages, ["en"], "/q send-in set");

    const co = await new ChangeOrderStore().create(USER, inv.id, {
      description: "Second coat",
      deltaAmountCents: 120_00,
      customerId: carmen.id,
    });
    const pco = await fetch(`${BASE}/change-orders/${co.id}/public`).then((r) =>
      r.json()
    );
    assertEquals(pco.commsLanguage, "en", "/co language");
    assertEquals(pco.sendLanguages, ["en"], "/co send-in set");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("REQ-925: with both languages ticked her Spanish still opens the documents (REQ-715 unchanged)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, {
    port: PORT + 1,
    swagger: false,
  });
  await server.listen();
  try {
    await new BusinessIdentityStore().upsert(USER, {
      businessName: "Ortega Handyman Services",
      commsLanguages: ["en", "es"],
      commsLanguage: "en",
    });
    const carmen = await new CustomerStore().create(USER, {
      name: "Carmen Ruiz",
      language: "es",
    } as CreateCustomerDto);
    const inv = await new InvoiceStore().create(USER, {
      customerId: carmen.id,
      status: "sent",
      amount: 450_00,
    });
    const pi = await fetch(
      `http://localhost:${PORT + 1}/invoices/${inv.id}/public`,
    )
      .then((r) => r.json());
    assertEquals(pi.docLang, "es");
    assertEquals(pi.contractor?.sendLanguages, ["en", "es"]);
  } finally {
    await server.stop();
    await resetKv();
  }
});
