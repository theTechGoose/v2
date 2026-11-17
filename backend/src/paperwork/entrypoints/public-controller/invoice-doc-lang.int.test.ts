/**
 * REQ-586 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue M11: the owner's in-app "Open" on an
 * invoice opened /i/<id> in English though the paperwork went out in
 * Spanish. /i resolved its language as ?lang → cookie → the contractor's
 * commsLanguage, never the document's own language.
 *
 * Integration over HTTP, app booted: GET /invoices/:id/public carries
 * `docLang` — the invoice's own `lang` (a standalone invoice), else the
 * language its linked quote was SENT in (lastDelivery.lang), else the
 * quote's base language — which /i uses as its document language ahead of
 * the contractor's default.
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

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;
const USER = "u-req586";

Deno.test("REQ-586 (cycle 4, M11): the public invoice names its document language — the invoice's own lang, else the language its quote was sent in", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const quotes = new QuoteStore();
    const invoices = new InvoiceStore();

    // A standalone invoice typed in Spanish.
    const standalone = await invoices.create(USER, {
      status: "sent",
      amount: 450_00,
      jobName: "Reparación de grifo",
    });
    await invoices.update(standalone.id, USER, { lang: "es" });
    const pub1 = await fetch(`${BASE}/invoices/${standalone.id}/public`)
      .then((r) => r.json());
    assertEquals(pub1.docLang, "es", JSON.stringify(pub1).slice(0, 300));

    // A quote-linked invoice: the quote went out in Spanish.
    const q = await quotes.create(USER, {
      summary: "Retiro de muebles",
      lineItems: [],
      estimatedTotal: 450_00,
      status: "accepted",
    });
    await quotes.update(q.id, USER, {
      lastDelivery: {
        at: new Date().toISOString(),
        channel: "sms",
        textedTo: "+15125550000",
        lang: "es",
      },
    });
    const linked = await invoices.create(USER, {
      status: "sent",
      amount: 450_00,
      quoteId: q.id,
    });
    const pub2 = await fetch(`${BASE}/invoices/${linked.id}/public`)
      .then((r) => r.json());
    assertEquals(pub2.docLang, "es");

    // Nothing recorded → no document language (the contractor's default
    // still applies on the page).
    const bare = await invoices.create(USER, { status: "sent", amount: 10_00 });
    const pub3 = await fetch(`${BASE}/invoices/${bare.id}/public`)
      .then((r) => r.json());
    assertEquals(pub3.docLang, undefined);
  } finally {
    await server.stop();
    await resetKv();
  }
});
