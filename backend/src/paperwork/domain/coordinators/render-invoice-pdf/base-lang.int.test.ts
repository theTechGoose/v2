/**
 * REQ-710 (demo-loop cycle 5, M4): "the English version of a Spanish-typed
 * quote/invoice keeps the Spanish title and lines". The invoice PDF (the /i
 * "Download PDF" and the e-mailed receipt) renders in the business's comms
 * language, but drew the job text exactly as typed: a standalone invoice's
 * `jobName` and `description`, a quote-linked invoice's line items, and the
 * payment instructions frozen in the owner's language ("· Efectivo"). It
 * now reads the same per-language copies /i reads.
 */
import { assert } from "#std/assert";
import { RenderInvoicePdf } from "./mod.ts";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

/** Every text the PDF draws: the inflated content streams. pdf-lib writes a
 *  standard-font string as WinAnsi hex, so a search looks for both forms. */
async function drawnText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let drawn = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        drawn += new TextDecoder("latin1").decode(
          decodePDFRawStream(obj).decode(),
        );
      } catch { /* an image or font stream */ }
    }
  }
  return drawn;
}

function draws(drawn: string, text: string): boolean {
  const hex = [...text].map((c) =>
    c.charCodeAt(0).toString(16).padStart(2, "0")
  ).join("").toUpperCase();
  return drawn.includes(text) || drawn.toUpperCase().includes(hex);
}

async function setup() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const now = new Date().toISOString();
  await (await getKv()).set(["user", "u-1"], {
    id: "u-1",
    phoneNumber: "+15125550108",
    name: "Rosa Díaz",
    email: "rosa@test.dev",
    createdAt: now,
    updatedAt: now,
  });
  const identities = new BusinessIdentityStore();
  // The customer reads English: the PDF renders in English.
  await identities.upsert("u-1", {
    businessName: "Díaz Hauling",
    commsLanguage: "en",
  });
  const invoices = new InvoiceStore();
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const customer = await customers.create("u-1", {
    name: "Jorge Ruiz",
    email: "jorge.ruiz@example.com",
  });
  const render = new RenderInvoicePdf(
    invoices,
    quotes,
    customers,
    new UserStore(),
    identities,
  );
  return { invoices, quotes, customer, render };
}

Deno.test("REQ-710 (cycle 5, M4) the English PDF of a standalone invoice typed in Spanish draws its English title, concepts and payment methods (pair 9)", async () => {
  const { invoices, customer, render } = await setup();
  try {
    const inv = await invoices.create("u-1", {
      customerId: customer.id,
      status: "sent",
      jobName: "Retiro de electrodomésticos",
      description: "Retiro de refrigerador y lavadora",
      amount: 20_000,
      paymentInstructions: "Zelle: +1 (512) 555-0108 · Efectivo",
    });
    // What TranslateInvoice stored: Spanish typed, English translated.
    await invoices.update(inv.id, "u-1", {
      lang: "es",
      jobNameByLang: {
        es: "Retiro de electrodomésticos",
        en: "Appliance Removal",
      },
      descriptionByLang: {
        es: "Retiro de refrigerador y lavadora",
        en: "Removal of refrigerator and washing machine",
      },
    });

    const drawn = await drawnText(await render.run(inv.id));

    assert(draws(drawn, "Appliance Removal"), "the English title");
    assert(
      draws(drawn, "Removal of refrigerator and washing machine"),
      "the English concepts",
    );
    assert(!draws(drawn, "Retiro"), "Spanish job text on the English PDF");
    assert(draws(drawn, "Cash"), "the cash method in English");
    assert(!draws(drawn, "Efectivo"), "'Efectivo' on the English PDF");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-710 (cycle 5, M4) the English PDF of a quote-linked invoice draws the quote's English line items, not the typed Spanish (pair 6)", async () => {
  const { invoices, quotes, customer, render } = await setup();
  try {
    const typed = [
      "Reparación de puerta de cocina",
      "Cambio de llave del fregadero",
    ];
    const english = ["Kitchen door repair", "Kitchen sink faucet replacement"];
    const created = await quotes.create("u-1", {
      customerId: customer.id,
      summary: "Reparación de puerta de cocina y cambio de llave",
      jobName: "Reparación de puerta",
      lineItems: typed.map((description) => ({
        description,
        quantity: 1,
        unit: "ea",
        price: 17_500,
      })),
      estimatedTotal: 35_000,
    });
    // What the lock's translation stored.
    const quote = await quotes.update(created.id, "u-1", {
      lang: "es",
      summaryByLang: {
        es: "Reparación de puerta de cocina y cambio de llave",
        en: "Kitchen door repair and faucet replacement",
      },
      lineItems: typed.map((description, i) => ({
        description,
        descriptionByLang: { es: description, en: english[i] },
        quantity: 1,
        unit: "ea",
        price: 17_500,
      })),
    });
    const inv = await invoices.create("u-1", {
      customerId: customer.id,
      quoteId: quote.id,
      status: "sent",
      amount: 35_000,
    });

    const drawn = await drawnText(await render.run(inv.id));

    for (const line of english) {
      assert(draws(drawn, line), `the English line "${line}"`);
    }
    assert(
      !draws(drawn, "Cambio de llave"),
      "a Spanish line on the English PDF",
    );
  } finally {
    await resetKv();
  }
});
