/**
 * REQ-1133 (LOOP-007 cycle 3, q3-65; amends REQ-272 + REQ-586) — "/i
 * 'Download PDF' link carries no lang".
 *
 * /i paints in ?lang (the EN | ES toggle, REQ-272), else the visitor's
 * cookie, else the invoice's own document language (REQ-586), clamped to the
 * contractor's send languages (REQ-925). Its Download PDF hits
 * GET /invoices/:id/pdf, which reads no language at all: RenderInvoicePdf.run
 * takes only the id and renders in the contractor's Settings commsLanguage.
 * A customer reading /i in Spanish downloads an English PDF, and the reverse.
 *
 * Integration over HTTP, app booted, KV :memory:. The PDF's language is read
 * from its title ("Invoice INV-…" / "Factura INV-…", REQ-204).
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { PDFDocument } from "#pdf-lib";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

async function seedUser(id: string) {
  const now = new Date().toISOString();
  await (await getKv()).set(["user", id], {
    id,
    phoneNumber: "+15125550133",
    name: "Luis Ortega",
    createdAt: now,
    updatedAt: now,
  });
}

async function pdfTitle(path: string): Promise<string | undefined> {
  const r = await fetch(`${BASE}${path}`);
  assertEquals(r.status, 200, `${path} → ${r.status}`);
  const doc = await PDFDocument.load(new Uint8Array(await r.arrayBuffer()));
  return doc.getTitle();
}

Deno.test("REQ-1133 (LOOP-007 q3, q3-65): GET /invoices/:id/pdf renders in ?lang, else the invoice's own document language — not only the contractor's Settings language", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const invoices = new InvoiceStore();
    const quotes = new QuoteStore();
    const identities = new BusinessIdentityStore();

    // An English-comms contractor who sends in both languages.
    const EN_USER = "u-req1133-en";
    await seedUser(EN_USER);
    await identities.upsert(EN_USER, {
      businessName: "Ortega Handyman Services",
      commsLanguage: "en",
      commsLanguages: ["en", "es"],
    });

    // A standalone invoice typed in Spanish: its document language is es.
    const esDoc = await invoices.create(EN_USER, {
      status: "sent",
      amount: 450_00,
      jobName: "Reparación de grifo",
    });
    await invoices.update(esDoc.id, EN_USER, { lang: "es" });
    const pub = await fetch(`${BASE}/invoices/${esDoc.id}/public`)
      .then((r) => r.json());
    assertEquals(pub.docLang, "es", "precondition: /i opens this in Spanish");
    const num = pub.number ?? esDoc.number;

    // /i opens it in Spanish (REQ-586), so its PDF is Spanish too.
    assertEquals(
      await pdfTitle(`/invoices/${esDoc.id}/pdf`),
      `Factura ${num}`,
      "no ?lang: the PDF follows the invoice's own document language (es), not the contractor's en",
    );
    // The visitor picked ES on /i (REQ-272): ?lang=es.
    assertEquals(
      await pdfTitle(`/invoices/${esDoc.id}/pdf?lang=es`),
      `Factura ${num}`,
      "?lang=es: the PDF is Spanish",
    );
    // The visitor picked EN on the same Spanish invoice.
    assertEquals(
      await pdfTitle(`/invoices/${esDoc.id}/pdf?lang=en`),
      `Invoice ${num}`,
      "?lang=en: the PDF is English",
    );

    // A quote-linked invoice whose quote went out in Spanish: docLang es.
    const q = await quotes.create(EN_USER, {
      summary: "Retiro de muebles",
      lineItems: [],
      estimatedTotal: 450_00,
      status: "accepted",
    });
    await quotes.update(q.id, EN_USER, {
      lastDelivery: {
        at: new Date().toISOString(),
        channel: "sms",
        textedTo: "+15125550000",
        lang: "es",
      },
    });
    const linked = await invoices.create(EN_USER, {
      status: "sent",
      amount: 450_00,
      quoteId: q.id,
    });
    assertEquals(
      await pdfTitle(`/invoices/${linked.id}/pdf`),
      `Factura ${linked.number}`,
      "a quote sent in Spanish: its invoice's PDF is Spanish",
    );

    // A Spanish-comms contractor; the visitor toggles /i to EN.
    const ES_USER = "u-req1133-es";
    await seedUser(ES_USER);
    await identities.upsert(ES_USER, {
      businessName: "Servicios Ortega",
      commsLanguage: "es",
      commsLanguages: ["en", "es"],
    });
    const plain = await invoices.create(ES_USER, {
      status: "sent",
      amount: 120_00,
    });
    assertEquals(
      await pdfTitle(`/invoices/${plain.id}/pdf?lang=en`),
      `Invoice ${plain.number}`,
      "?lang=en under an es-comms contractor: the PDF is English",
    );
    // No pick, no document language: the contractor's default still applies.
    assertEquals(
      await pdfTitle(`/invoices/${plain.id}/pdf`),
      `Factura ${plain.number}`,
      "no ?lang, no docLang: the contractor's comms language",
    );

    // REQ-925: a language the contractor does not send in is clamped away.
    const EN_ONLY = "u-req1133-enonly";
    await seedUser(EN_ONLY);
    await identities.upsert(EN_ONLY, {
      businessName: "Ortega Only English",
      commsLanguage: "en",
      commsLanguages: ["en"],
    });
    const enOnly = await invoices.create(EN_ONLY, {
      status: "sent",
      amount: 80_00,
    });
    assertEquals(
      await pdfTitle(`/invoices/${enOnly.id}/pdf?lang=es`),
      `Invoice ${enOnly.number}`,
      "?lang=es on an English-only account stays English (REQ-925)",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
