/**
 * REQ-628 — "They NEED THEIR LOGO NOT OURS": the invoice, quote and receipt
 * PDFs carry the business's logo (PNG or JPG) and never the house brand;
 * without a logo, the business name as a wordmark.
 */
import { assert, assertEquals } from "#std/assert";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { LoadBusinessLogo } from "./mod.ts";
import { RenderInvoicePdf } from "@paperwork/domain/coordinators/render-invoice-pdf/mod.ts";
import { RenderQuotePdf } from "@paperwork/domain/coordinators/render-quote-pdf/mod.ts";
import { RenderReceiptPdf } from "@paperwork/domain/coordinators/render-receipt-pdf/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { pdfFacts } from "@paperwork/domain/business/pdf-logo/inspect.ts";
import {
  TINY_JPG,
  WIDE_PNG,
} from "@paperwork/domain/business/pdf-logo/fixtures.ts";

async function seed(opts: { logo?: "png" | "jpg"; businessName?: string }) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", "u-1"], {
    id: "u-1",
    phoneNumber: "+15125550000",
    name: "Alexander Jerez",
    email: "alex@a2z.test",
    createdAt: now,
    updatedAt: now,
  });
  const identities = new BusinessIdentityStore();
  const files = new FileStore();
  let logoFileId: string | undefined;
  if (opts.logo) {
    logoFileId = (await files.create({
      userId: "u-1",
      filename: `logo.${opts.logo}`,
      mimeType: opts.logo === "png" ? "image/png" : "image/jpeg",
      bytes: opts.logo === "png" ? WIDE_PNG : TINY_JPG,
    })).id;
  }
  await identities.upsert("u-1", {
    ...(opts.businessName ? { businessName: opts.businessName } : {}),
    ...(logoFileId ? { logoFileId } : {}),
  });
  const customers = new CustomerStore();
  const customer = await customers.create("u-1", {
    name: "Randall Belknap",
    email: "rb@acme.test",
  });
  const invoices = new InvoiceStore();
  const inv = await invoices.create("u-1", {
    customerId: customer.id,
    status: "sent",
    jobName: "Spring cleanup",
    amount: 6500,
  });
  const quotes = new QuoteStore();
  const quote = await quotes.create("u-1", {
    customerId: customer.id,
    summary: "Spring cleanup",
    lineItems: [{
      description: "Cleanup",
      quantity: 1,
      unit: "job",
      price: 6500,
    }],
  } as never);
  return { invoices, customers, identities, files, inv, quote, customer };
}

async function renderAll(s: Awaited<ReturnType<typeof seed>>) {
  const logos = new LoadBusinessLogo(s.identities, s.files);
  const invoicePdf = await new RenderInvoicePdf(
    s.invoices,
    new QuoteStore(),
    s.customers,
    new UserStore(),
    s.identities,
    new ChangeOrderStore(), // REQ-679 (demo-fixes): the agreement's change orders
    logos,
  ).run(s.inv.id);
  const logo = await logos.run("u-1");
  const contractor = await new UserStore().get("u-1");
  const ident = await s.identities.get("u-1");
  const quotePdf = await new RenderQuotePdf().run({
    quote: s.quote,
    customer: s.customer,
    contractor,
    ...(ident?.businessName ? { businessName: ident.businessName } : {}),
    logo,
  });
  const receiptPdf = await new RenderReceiptPdf().run({
    invoice: { ...s.inv, status: "paid", paidAt: new Date().toISOString() },
    customer: s.customer,
    contractor,
    ...(ident?.businessName ? { businessName: ident.businessName } : {}),
    method: "zelle",
    confirmedAt: new Date().toISOString(),
    logo,
  });
  return { invoicePdf, quotePdf, receiptPdf };
}

for (const kind of ["png", "jpg"] as const) {
  Deno.test(`REQ-628 a ${kind.toUpperCase()} logo heads the invoice, quote and receipt PDFs; "DocuMonster" appears nowhere`, async () => {
    const s = await seed({ logo: kind, businessName: "A2Z Landscape LLC" });
    const logo = await new LoadBusinessLogo(s.identities, s.files).run("u-1");
    assertEquals(
      logo?.bytes.length,
      (kind === "png" ? WIDE_PNG : TINY_JPG).length,
    );
    const pdfs = await renderAll(s);
    for (const [name, bytes] of Object.entries(pdfs)) {
      const f = await pdfFacts(bytes);
      assertEquals(f.images, 1, `${name}: one embedded image (the logo)`);
      assert(f.imagesPerPage[0] >= 1, `${name}: the logo is painted on page 1`);
      const all =
        `${f.text}\n${f.title}\n${f.author}\n${f.producer}\n${f.creator}`;
      assertEquals(
        /docu\s*monster/i.test(all),
        false,
        `${name} mentions DocuMonster`,
      );
      assertEquals(
        /powered by/i.test(f.text),
        false,
        `${name} has a Powered-by line`,
      );
    }
    await resetKv();
  });
}

Deno.test("REQ-628 no logo: the business name is the wordmark on every PDF — no image, no DocuMonster", async () => {
  const s = await seed({ businessName: "A2Z Landscape LLC" });
  assertEquals(
    await new LoadBusinessLogo(s.identities, s.files).run("u-1"),
    undefined,
  );
  const pdfs = await renderAll(s);
  for (const [name, bytes] of Object.entries(pdfs)) {
    const f = await pdfFacts(bytes);
    assertEquals(f.images, 0, name);
    assert(
      /A2Z Landscape LLC/i.test(f.text),
      `${name} draws the business name`,
    );
    assertEquals(/docu\s*monster/i.test(f.text), false, name);
  }
  await resetKv();
});

Deno.test("REQ-628 no logo and no business name: the contractor's name, never DocuMonster", async () => {
  const s = await seed({});
  const pdfs = await renderAll(s);
  for (const [name, bytes] of Object.entries(pdfs)) {
    const f = await pdfFacts(bytes);
    assert(
      /Alexander Jerez/i.test(f.text),
      `${name} draws the contractor's name`,
    );
    assertEquals(/docu\s*monster/i.test(f.text), false, name);
  }
  await resetKv();
});

Deno.test("REQ-628 a logo that is not PNG/JPG (or a deleted file) falls back to the wordmark instead of failing", async () => {
  const s = await seed({ businessName: "A2Z Landscape LLC" });
  const svg = await s.files.create({
    userId: "u-1",
    filename: "logo.svg",
    mimeType: "image/svg+xml",
    bytes: new TextEncoder().encode("<svg/>"),
  });
  await s.identities.upsert("u-1", { logoFileId: svg.id });
  const pdfs = await renderAll(s);
  const f = await pdfFacts(pdfs.invoicePdf);
  assertEquals(f.images, 0);
  assert(/A2Z Landscape LLC/i.test(f.text));
  await s.identities.upsert("u-1", { logoFileId: "gone" });
  assertEquals(
    await new LoadBusinessLogo(s.identities, s.files).run("u-1"),
    undefined,
  );
  await resetKv();
});
