import { assert, assertEquals } from "#std/assert";
import { RenderInvoicePdf } from "./mod.ts";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { RenderInvoicePrintPdf } from "../render-invoice-print-pdf/mod.ts";
import { LoadBusinessLogo } from "../load-business-logo/mod.ts";

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

async function renderOne(
  fields: Record<string, unknown>,
  identity: Record<string, unknown> = {},
) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const identities = new BusinessIdentityStore();
  await seedContractor("u-1");
  await identities.upsert("u-1", {
    businessName: "A2Z Landscape LLC",
    ...identity,
  } as never);
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

// REQ-805 — A2Z added Xpress Pay in Settings; the site's invoice offers it, so the printable one
// does too: a "How to pay" section with every way on, the payment link by its name and its URL.
Deno.test("REQ-805 render-invoice-pdf: the invoice PDF lists how to pay — the methods on and the business's payment link by name and URL", async () => {
  const up = await renderOne({
    jobName: "Lawn care",
    lineItems: [{ description: "Lawn", quantity: 1, price: 6500 }],
    amount: 6500,
  }, {
    acceptedPaymentMethods: {
      zelle: { enabled: true, handle: "pay@a2z.test" },
      links: [{ id: "l1", name: "Xpress Pay", url: "https://www.xpress-pay.com/a2z", enabled: true }],
    },
  });
  assert(up.includes(hexOf("HOW TO PAY")), "the How to pay section");
  assert(up.includes(hexOf("Xpress Pay")), "the payment link, by its name");
  assert(up.includes(hexOf("https://www.xpress-pay.com/a2z")), "and its URL");
  assert(up.includes(hexOf("pay@a2z.test")), "Zelle with its handle");
});

// REQ-906 — the customer's name is the biggest thing on the invoice: the PDF
// draws the first Bill-to line at 11 pt (the From block stays 9 pt).
Deno.test("REQ-906 render-invoice-pdf: the Bill-to name is drawn at 11pt", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const identities = new BusinessIdentityStore();
  await seedContractor("u-1");
  await identities.upsert("u-1", { businessName: "A2Z Landscape LLC" });
  const customer = await customers.create("u-1", {
    name: "Robert Frakes",
    email: "rf@acme.test",
  });
  const inv = await invoices.create("u-1", {
    customerId: customer.id,
    status: "draft",
    jobName: "Maintenance 2026-10-01 → 2026-10-31",
    amount: 35000,
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
      } catch { /* an image or font stream */ }
    }
  }
  const up = drawn.toUpperCase();
  const hex = (s: string) =>
    [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
      .toUpperCase();
  assert(up.includes(hex("Robert Frakes")), "the customer's name is drawn");
  // pdf-lib emits "/F<n> <size> Tf" right before the text it sizes
  assert(
    new RegExp(`11 TF[\\s\\S]{0,200}?${hex("Robert Frakes")}`).test(up),
    "the name follows an 11 Tf (the Bill-to first line is 11 pt)",
  );
  assert(
    new RegExp(`9 TF[\\s\\S]{0,200}?${hex("A2Z Landscape LLC")}`).test(up),
    "the From block's business line is still 9 pt",
  );
  await resetKv();
});

// REQ-923 — "on the invoice it says 'check accepted' it should say 'send to' <address>"
Deno.test("REQ-923 invoice PDFs: with checks on and no mail-to, both the invoice PDF and the printed invoice say 'Send to: <business address>'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const identities = new BusinessIdentityStore();
  const addresses = new BusinessAddressStore();
  await seedContractor("u-1");
  await identities.upsert("u-1", {
    businessName: "A2Z Landscape LLC",
    acceptedPaymentMethods: { check: { enabled: true } },
  } as never);
  await addresses.upsert("u-1", { street: "12 Oak St", city: "Austin", state: "TX", postal: "78701" });
  const customer = await customers.create("u-1", { name: "Robert Thall", email: "rt@acme.test" });
  const inv = await invoices.create("u-1", {
    customerId: customer.id,
    status: "sent",
    jobName: "Lawn",
    lineItems: [{ description: "Lawn", quantity: 1, unit: "visit", price: 6500 }],
    amount: 6500,
  } as never);
  const pdf = await drawnUpper(
    await new RenderInvoicePdf(
      invoices,
      new QuoteStore(),
      customers,
      new UserStore(),
      identities,
      undefined,
      undefined,
      addresses,
    ).run(inv.id),
  );
  const print = await drawnUpper(
    await new RenderInvoicePrintPdf(
      invoices,
      customers,
      new UserStore(),
      identities,
      addresses,
      new LoadBusinessLogo(),
    ).run("u-1", [inv.id]),
  );
  for (const [name, up] of [["invoice PDF", pdf], ["printed invoice", print]]) {
    assert(up.includes(hexOf("Send to: 12 Oak St, Austin, TX 78701")), `${name}: 'Send to: <address>' is drawn`);
    assert(!up.includes(hexOf("Check accepted")), `${name}: no 'Check accepted'`);
  }
  await resetKv();
});

// REQ-928 — "when an invoice is paid, it should show the method of payment and
// when it was paid in all views. print electronic or other." Both PDFs — the
// invoice PDF and the printed invoice — say how and when; a paid invoice from
// before REQ-928 (no paidMethods) reads its payment row.
Deno.test("REQ-928 invoice PDFs: a paid invoice prints 'Paid <date> · Electronic (Venmo)' / 'Other (Check)' on both PDFs", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const identities = new BusinessIdentityStore();
  await seedContractor("u-1");
  await identities.upsert(
    "u-1",
    { businessName: "A2Z Landscape LLC" } as never,
  );
  const customer = await customers.create("u-1", {
    name: "Robert Thall",
    email: "rt@acme.test",
  });
  const base = {
    customerId: customer.id,
    jobName: "Lawn",
    lineItems: [{
      description: "Lawn",
      quantity: 1,
      unit: "visit",
      price: 6500,
    }],
    amount: 6500,
    paidCents: 6500,
    status: "paid",
    paidAt: "2026-11-11T15:00:00.000Z",
  };
  const venmo = await invoices.create(
    "u-1",
    { ...base, paidMethods: ["venmo"] } as never,
  );
  const legacy = await invoices.create("u-1", base as never);
  const { PaymentStore } = await import(
    "@paperwork/domain/data/payment-store/mod.ts"
  );
  await new PaymentStore().create("u-1", {
    invoiceId: legacy.id,
    amount: 6500,
    method: "check",
    receivedAt: "2026-11-11T15:00:00.000Z",
  });
  const pdfOf = async (id: string) =>
    await drawnUpper(
      await new RenderInvoicePdf(
        invoices,
        new QuoteStore(),
        customers,
        new UserStore(),
        identities,
      ).run(id),
    );
  const printOf = async (id: string) =>
    await drawnUpper(
      await new RenderInvoicePrintPdf(
        invoices,
        customers,
        new UserStore(),
        identities,
        new BusinessAddressStore(),
        new LoadBusinessLogo(),
      ).run("u-1", [id]),
    );
  for (
    const [name, up] of [["invoice PDF", await pdfOf(venmo.id)], [
      "printed invoice",
      await printOf(venmo.id),
    ]]
  ) {
    assert(
      up.includes(hexOf("Paid November 11, 2026 · Electronic (Venmo)")),
      `${name}: the paid line with the method`,
    );
  }
  for (
    const [name, up] of [["invoice PDF", await pdfOf(legacy.id)], [
      "printed invoice",
      await printOf(legacy.id),
    ]]
  ) {
    assert(
      up.includes(hexOf("Paid November 11, 2026 · Other (Check)")),
      `${name}: a pre-REQ-928 invoice reads its payment`,
    );
  }
  await resetKv();
});

// REQ-966 (LOOP-007 q1, q1-41) — an amount-only invoice (no quote, no job
// name) that is partly paid (stored status "pending") and past its due date.
// The /i page shows the pill "Past due" / "Vencida" and the heading
// "Project" / "Proyecto" (publicInvoice.jobNameFallback). The PDF printed
// the raw enum "PENDING" and the quote PDF's "Service Agreement".
const pastDay = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const overdueAmountOnly = () => ({
  status: "pending",
  amount: 120000,
  paidCents: 40000,
  issuedDate: pastDay(40),
  dueDate: pastDay(10),
});
const anyOf = (up: string, words: string[]) =>
  words.some((w) => up.includes(hexOf(w)));

for (
  const [lang, identity, want] of [
    ["en", {}, {
      past: ["PAST DUE", "Past due", "OVERDUE", "Overdue"],
      // REQ-984 (q1-60): /i heads an amount-only invoice "Invoice INV-001"
      title: "Invoice ",
      oldTitle: "Project",
      notTitle: "Service Agreement",
    }],
    ["es", { commsLanguage: "es" }, {
      past: ["VENCIDA", "Vencida"],
      title: "Factura ",
      oldTitle: "Proyecto",
      notTitle: "Acuerdo De Servicio",
    }],
  ] as const
) {
  Deno.test(`REQ-966 q1-41 render-invoice-pdf (${lang}): a past-due, partly-paid, amount-only invoice is stamped past due and titled like /i — not 'PENDING', not '${want.notTitle}'`, async () => {
    const up = await renderOne(overdueAmountOnly(), identity);
    const wrong: string[] = [];
    const check = (ok: boolean, msg: string) => ok || wrong.push(msg);
    check(
      !up.includes(hexOf("PENDING")),
      `${lang}: the raw stored status 'PENDING' is not printed`,
    );
    check(
      anyOf(up, [...want.past]),
      `${lang}: the past-due label (${want.past.join(" / ")}) is printed, as on /i`,
    );
    check(
      !up.includes(hexOf(want.notTitle)) &&
        !up.includes(hexOf(want.notTitle.toUpperCase())),
      `${lang}: the invoice is not titled '${want.notTitle}' (the quote PDF's fallback)`,
    );
    check(
      up.includes(hexOf(want.title)),
      `${lang}: the hero title falls back to '${want.title}<number>', as /i does (REQ-984)`,
    );
    check(
      !up.includes(hexOf(want.oldTitle)),
      `${lang}: the hero title is never the placeholder '${want.oldTitle}' (REQ-984)`,
    );
    assertEquals(wrong, [], `${lang}: the PDF disagrees with /i`);
  });
}

// REQ-966 (q1-41) — a paid amount-only invoice (INV-001 in the run) is not
// titled "Service Agreement" either.
Deno.test("REQ-966 q1-41 render-invoice-pdf: a paid amount-only invoice is titled 'Invoice <number>' (REQ-984), not 'Project' or 'Service Agreement'", async () => {
  const up = await renderOne({
    status: "paid",
    amount: 50000,
    paidCents: 50000,
    paidAt: new Date(Date.now() - 86_400_000).toISOString(),
    dueDate: pastDay(1),
  });
  const wrong: string[] = [];
  if (up.includes(hexOf("Service Agreement"))) wrong.push("titled 'Service Agreement'");
  // REQ-984 (q1-60): /i heads it "Invoice INV-001", never "Project"
  if (!up.includes(hexOf("Invoice "))) wrong.push("no /i fallback title 'Invoice <number>'");
  if (up.includes(hexOf("Project"))) wrong.push("titled 'Project'");
  assertEquals(wrong, [], "the paid invoice's PDF title matches /i");
});
