import { assert, assertEquals } from "#std/assert";
import { RenderInvoicePdf } from "./mod.ts";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

async function seedContractor(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550000",
    name: "Alexander Jerez",
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  });
}

// REQ-161 — "download pdf gives 500." — prod answered
// {"status":500,"message":"WinAnsi cannot encode \"→\" (0x2192)"} for every batch invoice
Deno.test("REQ-161 render-invoice-pdf: a batch invoice titled 'Maintenance 2026-10-01 → 2026-10-31' (and lines with emoji) renders a PDF instead of throwing", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const identities = new BusinessIdentityStore();
  await seedContractor("u-1");
  await identities.upsert("u-1", { businessName: "A2Z Landscape LLC" });
  const customer = await customers.create("u-1", {
    name: "Randall Belknap",
    email: "rb@acme.test",
  });
  const inv = await invoices.create("u-1", {
    customerId: customer.id,
    status: "draft",
    jobName: "Maintenance 2026-10-01 → 2026-10-31",
    description: "Oct 2 — Lawn — 725 Frederick Rd ✅",
    lineItems: [{
      description: "Oct 2 — Lawn — 725 Frederick Rd ✅",
      quantity: 1,
      unit: "visit",
      price: 6500,
    }],
    amount: 6500,
  });
  const render = new RenderInvoicePdf(
    invoices,
    new QuoteStore(),
    customers,
    new UserStore(),
    identities,
  );
  const bytes = await render.run(inv.id);
  assert(bytes.length > 1000, `a real PDF (${bytes.length} bytes)`);
  assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  await resetKv();
});

// REQ-168 — the business website on the invoice PDF's From block
Deno.test("REQ-168 render-invoice-pdf: the From block carries the business website", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const identities = new BusinessIdentityStore();
  await seedContractor("u-1");
  await identities.upsert("u-1", {
    businessName: "A2Z Landscape LLC",
    websiteUrl: "https://a2zlandscape.com/",
  });
  const customer = await customers.create("u-1", {
    name: "Randall Belknap",
    email: "rb@acme.test",
  });
  const inv = await invoices.create("u-1", {
    customerId: customer.id,
    status: "draft",
    jobName: "Maintenance",
    amount: 6500,
  });
  const render = new RenderInvoicePdf(
    invoices,
    new QuoteStore(),
    customers,
    new UserStore(),
    identities,
  );
  const bytes = await render.run(inv.id);
  // the content streams are Flate-compressed; inflate them and look for the WinAnsi hex of the label
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
  const hex = [..."a2zlandscape.com"].map((c) =>
    c.charCodeAt(0).toString(16).padStart(2, "0")
  ).join("").toUpperCase();
  assert(
    drawn.includes("a2zlandscape.com") || drawn.toUpperCase().includes(hex),
    "the PDF draws the website label",
  );
  await resetKv();
});

// REQ-173 — the PDF groups a batch invoice's visits under the address too
Deno.test("REQ-173 render-invoice-pdf: a batch invoice's PDF draws the address as a heading and the visits under it, not the flat lines", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const identities = new BusinessIdentityStore();
  await seedContractor("u-1");
  await identities.upsert("u-1", { businessName: "A2Z Landscape LLC" });
  const customer = await customers.create("u-1", {
    name: "Randall Belknap",
    email: "rb@acme.test",
  });
  const addr = "725 Frederick Rd, Rockingham, VA 22801-1306";
  const inv = await invoices.create("u-1", {
    customerId: customer.id,
    status: "draft",
    jobName: "Maintenance 2026-10-01 → 2026-10-31",
    description: `Oct 2 — Lawn — ${addr}\nOct 9 — Lawn — ${addr}`,
    lineItems: [
      {
        description: `Oct 2 — Lawn — ${addr}`,
        quantity: 1,
        unit: "visit",
        price: 6500,
        date: "2026-10-02",
        service: "Lawn",
        address: addr,
      },
      {
        description: `Oct 9 — Lawn — ${addr}`,
        quantity: 1,
        unit: "visit",
        price: 6500,
        date: "2026-10-09",
        service: "Lawn",
        address: addr,
      },
    ],
    amount: 13000,
  });
  const render = new RenderInvoicePdf(
    invoices,
    new QuoteStore(),
    customers,
    new UserStore(),
    identities,
  );
  const bytes = await render.run(inv.id);
  const doc = await PDFDocument.load(bytes);
  let drawn = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        drawn += new TextDecoder("latin1").decode(
          decodePDFRawStream(obj).decode(),
        );
      } catch { /* not text */ }
    }
  }
  const hex = (s: string) =>
    [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
      .toUpperCase();
  const up = drawn.toUpperCase();
  assert(up.includes(hex(addr)), "the address is drawn as its own heading");
  assert(
    up.includes(hex("Oct 2")) && up.includes(hex("Oct 9")),
    "each visit's date is drawn",
  );
  // the flat "Oct 2 — Lawn — 725 …" (— is WinAnsi 0x97) is not drawn
  assert(
    !up.includes(hex("Oct 2 ") + "97" + hex(" Lawn ") + "97"),
    "no flat line",
  );
  await resetKv();
});

async function drawnUpper(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let drawn = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        drawn += new TextDecoder("latin1").decode(decodePDFRawStream(obj).decode());
      } catch { /* not text */ }
    }
  }
  return drawn.toUpperCase();
}
const hexOf = (s: string) =>
  [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase();

async function renderOne(fields: Record<string, unknown>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const identities = new BusinessIdentityStore();
  await seedContractor("u-1");
  await identities.upsert("u-1", { businessName: "A2Z Landscape LLC" });
  const customer = await customers.create("u-1", { name: "Robert Thall", email: "rt@acme.test" });
  // deno-lint-ignore no-explicit-any
  const inv = await invoices.create("u-1", { customerId: customer.id, status: "draft", ...fields } as any);
  const bytes = await new RenderInvoicePdf(invoices, new QuoteStore(), customers, new UserStore(), identities).run(inv.id);
  const up = await drawnUpper(bytes);
  await resetKv();
  return up;
}

// REQ-791 — A2Z's edited batch draft: the lines lost date/service/address; the PDF still groups
// them by address, then date, with the amount at the end — and the joined "Oct 2 — Lawn — …"
// paragraph is not drawn under the title.
Deno.test("REQ-791 render-invoice-pdf: a batch draft whose lines lost their visit fields is drawn grouped by address, then date — no flat paragraph", async () => {
  const addr = "845 Frederick Rd, Rockingham, VA 22801-1314";
  const days = ["Oct 2", "Oct 8", "Oct 9"];
  const up = await renderOne({
    jobName: "Maintenance 2026-10-01 → 2026-10-31",
    serviceDateFrom: "2026-10-01",
    serviceDateTo: "2026-10-31",
    description: days.map((d) => `${d} — Lawn — ${addr}`).join("\n"),
    lineItems: days.map((d) => ({ description: `${d} — Lawn — ${addr}`, quantity: 1, unit: "visit", price: 6500 })),
    amount: 19500,
  });
  assert(up.includes(hexOf(addr)), "the address is a heading");
  assert(up.includes(hexOf("Oct 8")) && up.includes(hexOf("$65.00")), "each date, with its amount");
  assert(!up.includes(hexOf("Oct 2 ") + "97" + hexOf(" Lawn ") + "97"), "no flat 'Oct 2 — Lawn — …' line");
});

// REQ-792 — "printable invoices should look the same as the site invoices": the site's numbered
// "01 Job details" section with the DESCRIPTION / AMOUNT table of the invoice's own lines.
Deno.test("REQ-792 render-invoice-pdf: a standalone invoice draws the site's numbered Job details section with its own lines and amounts", async () => {
  const up = await renderOne({
    jobName: "Spring cleanup",
    description: "Front beds\nBack beds",
    lineItems: [
      { description: "Mulch install", quantity: 1, price: 30000 },
      { description: "Hedge trim", quantity: 1, price: 12500 },
    ],
    amount: 42500,
  });
  assert(up.includes(hexOf("JOB DETAILS")), "the Job details section header");
  assert(up.includes(hexOf("DESCRIPTION")) && up.includes(hexOf("AMOUNT")), "the table header");
  assert(up.includes(hexOf("Mulch install")) && up.includes(hexOf("$300.00")), "a line and its amount");
  assert(up.includes(hexOf("Hedge trim")) && up.includes(hexOf("$125.00")), "the other line");
  assert(up.includes(hexOf("Front beds")), "the description, in the section");
});
