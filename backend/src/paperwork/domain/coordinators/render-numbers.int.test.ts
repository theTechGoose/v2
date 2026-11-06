/**
 * REQ-204 / REQ-201 — everything the backend renders (PDF, email, SMS,
 * receipt, alerts) names a document by its number and version, and an
 * issued document shows the customer as snapshotted when it was issued.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import type { SendSmsInput } from "@users/domain/data/sms/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Customer } from "@crm/dto/customer.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { RenderInvoicePdf } from "./render-invoice-pdf/mod.ts";
import { RenderQuotePdf } from "./render-quote-pdf/mod.ts";
import { RenderReceiptPdf } from "./render-receipt-pdf/mod.ts";
import {
  renderInvoiceHtml,
  renderInvoicePaidSubject,
  renderInvoiceSubject,
  renderQuoteHtml,
  renderQuoteSubject,
} from "./send-paperwork-email/mod.ts";
import {
  renderInvoiceBody,
  renderQuoteBody,
} from "./send-paperwork-sms/mod.ts";
import {
  renderReceiptHtml,
  renderReceiptSubject,
} from "./confirm-payment/mod.ts";
import { SendChangeOrderAlert } from "./send-change-order-alert/mod.ts";
import { SendAcceptedAlert } from "./send-accepted-alert/mod.ts";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const USER = "u-1";
const BIZ = "A2Z Landscape LLC";
const SNAPSHOT_NAME = "Randall Belknap";
const LIVE_NAME = "Someone Else";
const ONE_PX_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function withKv<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  try {
    return await fn();
  } finally {
    await resetKv();
  }
}

async function seedContractor(userId = USER): Promise<User> {
  const kv = await getKv();
  const now = new Date().toISOString();
  const user = {
    id: userId,
    phoneNumber: "+15125550000",
    name: "Test Contractor",
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  } as User;
  await kv.set(["user", userId], user);
  return user;
}

/** Overwrite stored fields on a KV row (the number / version a store would have assigned). */
async function patchRow<T>(key: Deno.KvKey, patch: Partial<T>): Promise<T> {
  const kv = await getKv();
  const cur = (await kv.get<T>(key)).value as T;
  const next = { ...cur, ...patch };
  await kv.set(key, next);
  return next;
}

/** Every string pdf-lib drew (the content streams are Flate-compressed hex-string Tj operators). */
async function drawnText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let s: string;
    try {
      s = new TextDecoder("latin1").decode(decodePDFRawStream(obj).decode());
    } catch {
      continue;
    }
    for (const m of s.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      const hex = m[1];
      let line = "";
      for (let i = 0; i + 1 < hex.length; i += 2) {
        line += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
      out += line + "\n";
    }
    for (const m of s.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
      out += m[1] + "\n";
    }
  }
  return out;
}

const sender: User = {
  id: USER,
  name: "Test Contractor",
  email: "me@test.dev",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;
const bizOf = (
  lang: "en" | "es",
): BusinessIdentity => ({
  userId: USER,
  businessName: BIZ,
  commsLanguage: lang,
} as unknown as BusinessIdentity);

const liveCustomer: Customer = {
  id: "c-1",
  userId: USER,
  name: LIVE_NAME,
  email: "live@acme.test",
  phoneNumber: "+15125550111",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as Customer;

function invoiceFixture(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "0123abcd-0000-4000-8000-000000000001",
    userId: USER,
    number: "INV-5000",
    version: 1,
    status: "sent",
    sentAt: "2026-10-01T12:00:00Z",
    customerId: "c-1",
    customerSnapshot: {
      name: SNAPSHOT_NAME,
      email: "rb@acme.test",
      phoneNumber: "+15125550222",
    },
    jobName: "October maintenance",
    description: "Lawn and beds",
    lineItems: [{
      description: "Lawn",
      quantity: 1,
      unit: "visit",
      price: 100_00,
    }],
    subtotalCents: 100_00,
    discountCents: 10_00,
    discountReason: "Loyalty",
    taxRateBp: 825,
    taxCents: 7_43,
    amount: 97_43,
    serviceAddress: "725 Frederick Rd, Rockingham, VA",
    serviceDateFrom: "2026-10-01",
    serviceDateTo: "2026-10-31",
    paymentInstructions: "Zelle to 555-0100",
    dueDate: "2026-11-15",
    issuedDate: "2026-10-01",
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-01T12:00:00Z",
    ...over,
  } as Invoice;
}

function quoteFixture(over: Partial<Quote> = {}): Quote {
  return {
    id: "4567efab-0000-4000-8000-000000000002",
    userId: USER,
    number: "Q-001",
    version: 1,
    status: "sent",
    sentAt: "2026-09-20T12:00:00Z",
    customerId: "c-1",
    customerSnapshot: { name: SNAPSHOT_NAME, email: "rb@acme.test" },
    summary: "Fall cleanup",
    jobName: "Fall cleanup",
    lineItems: [{
      description: "Cleanup",
      quantity: 1,
      unit: "job",
      price: 500_00,
    }],
    estimatedTotal: 500_00,
    createdAt: "2026-09-20T12:00:00Z",
    updatedAt: "2026-09-20T12:00:00Z",
    ...over,
  } as Quote;
}

// ---------------------------------------------------------------------------
// PDFs
// ---------------------------------------------------------------------------

Deno.test("REQ-204 REQ-201 invoice PDF: names the bill 'INV-5000 · Version 2' with the revised line, shows the snapshotted customer (not the renamed live record), and the REQ-206 fields", async () => {
  await withKv(async () => {
    const invoices = new InvoiceStore();
    const quotes = new QuoteStore();
    const customers = new CustomerStore();
    const identities = new BusinessIdentityStore();
    await seedContractor();
    await identities.upsert(USER, { businessName: BIZ });
    const customer = await customers.create(USER, {
      name: SNAPSHOT_NAME,
      email: "rb@acme.test",
    });
    const quote = await quotes.create(USER, {
      customerId: customer.id,
      summary: "Fall cleanup",
      lineItems: [],
    });
    const created = await invoices.create(USER, {
      customerId: customer.id,
      quoteId: quote.id,
      status: "sent",
      jobName: "October maintenance",
      subtotalCents: 100_00,
      discountCents: 10_00,
      discountReason: "Loyalty",
      taxRateBp: 825,
      taxCents: 7_43,
      amount: 97_43,
      serviceAddress: "725 Frederick Rd, Rockingham, VA",
      serviceDateFrom: "2026-10-01",
      serviceDateTo: "2026-10-31",
      paymentInstructions: "Zelle to 555-0100",
      dueDate: "2026-11-15",
    });
    assertEquals(created.customerSnapshot?.name, SNAPSHOT_NAME);
    await patchRow<Invoice>(["invoice", created.id], {
      number: "INV-5000",
      version: 2,
    });
    // the CRM record changes AFTER the bill went out — the bill must not
    await customers.update(customer.id, USER, { name: LIVE_NAME });

    const bytes = await new RenderInvoicePdf(
      invoices,
      quotes,
      customers,
      new UserStore(),
      identities,
    ).run(created.id);
    const text = await drawnText(bytes);
    const idSlice = created.id.slice(0, 8).toUpperCase();
    assertStringIncludes(text, "INV-5000");
    assertStringIncludes(text, "Version 2");
    assertStringIncludes(text, "Revised invoice");
    assert(!text.includes(`#${idSlice}`), `no id slice on the PDF: ${idSlice}`);
    assertStringIncludes(text, SNAPSHOT_NAME);
    assert(
      !text.includes(LIVE_NAME),
      "the renamed live customer never rewrites an issued bill",
    );
    assertStringIncludes(text, "8.25%");
    assertStringIncludes(text, "Loyalty");
    assertStringIncludes(text, "Zelle to 555-0100");
    assertStringIncludes(text, "725 Frederick Rd");
    assertStringIncludes(text, "Q-001");
    assertEquals(
      (await PDFDocument.load(bytes)).getTitle(),
      "Invoice INV-5000",
    );
  });
});

Deno.test("REQ-204 invoice PDF: a DRAFT shows the live customer record", async () => {
  await withKv(async () => {
    const invoices = new InvoiceStore();
    const customers = new CustomerStore();
    const identities = new BusinessIdentityStore();
    await seedContractor();
    const customer = await customers.create(USER, {
      name: SNAPSHOT_NAME,
      email: "rb@acme.test",
    });
    const created = await invoices.create(USER, {
      customerId: customer.id,
      status: "draft",
      jobName: "Maintenance",
      amount: 50_00,
    });
    await customers.update(customer.id, USER, { name: LIVE_NAME });
    const bytes = await new RenderInvoicePdf(
      invoices,
      new QuoteStore(),
      customers,
      new UserStore(),
      identities,
    ).run(created.id);
    const text = await drawnText(bytes);
    assertStringIncludes(text, LIVE_NAME);
    assertStringIncludes(text, "INV-001");
  });
});

Deno.test("REQ-201 invoice PDF: PAID with the date, 'Paid $X · Balance $Y' on a partial payment, and the overpayment line", async () => {
  await withKv(async () => {
    const invoices = new InvoiceStore();
    const customers = new CustomerStore();
    const identities = new BusinessIdentityStore();
    await seedContractor();
    const customer = await customers.create(USER, { name: SNAPSHOT_NAME });
    const render = new RenderInvoicePdf(
      invoices,
      new QuoteStore(),
      customers,
      new UserStore(),
      identities,
    );

    const paid = await invoices.create(USER, {
      customerId: customer.id,
      status: "paid",
      paidAt: "2026-10-20T12:00:00Z",
      amount: 100_00,
      jobName: "A",
    });
    await patchRow<Invoice>(["invoice", paid.id], { paidCents: 100_00 });
    const paidText = await drawnText(await render.run(paid.id));
    assertStringIncludes(paidText, "PAID");
    assertStringIncludes(paidText, "October 20, 2026");

    const partial = await invoices.create(USER, {
      customerId: customer.id,
      status: "sent",
      amount: 100_00,
      jobName: "B",
    });
    await patchRow<Invoice>(["invoice", partial.id], { paidCents: 40_00 });
    const partialText = await drawnText(await render.run(partial.id));
    assertStringIncludes(partialText, "Paid $40.00 · Balance $60.00");

    const over = await invoices.create(USER, {
      customerId: customer.id,
      status: "paid",
      paidAt: "2026-10-21T12:00:00Z",
      amount: 100_00,
      jobName: "C",
    });
    await patchRow<Invoice>(["invoice", over.id], {
      paidCents: 105_00,
      overpaidCents: 5_00,
    });
    const overText = await drawnText(await render.run(over.id));
    assertStringIncludes(overText, "Overpaid by $5.00");
  });
});

Deno.test("REQ-204 REQ-201 quote PDF: 'Q-001 · Version 2', the revised line, 'Accepted and signed · <date>' with the drawn signature and signer, and the snapshotted customer", async () => {
  const quote = quoteFixture({
    version: 2,
    status: "accepted",
    acceptedAt: "2026-10-02T15:00:00Z",
    acceptedName: SNAPSHOT_NAME,
    acceptedSignature: ONE_PX_PNG,
  });
  const bytes = await new RenderQuotePdf().run({
    quote,
    customer: liveCustomer,
    contractor: sender,
    businessName: BIZ,
  });
  const text = await drawnText(bytes);
  assertStringIncludes(text, "Q-001");
  assertStringIncludes(text, "Version 2");
  assertStringIncludes(text, "Revised quote");
  assertStringIncludes(text, "Accepted and signed");
  assertStringIncludes(text, "October 2, 2026");
  assertStringIncludes(text, SNAPSHOT_NAME);
  assert(
    !text.includes(LIVE_NAME),
    "the live CRM record does not rewrite the signed agreement",
  );
  assert(
    !text.includes(`#${quote.id.slice(0, 8).toUpperCase()}`),
    "no id slice",
  );
  assertStringIncludes(new TextDecoder("latin1").decode(bytes), "/Image");
  assertEquals((await PDFDocument.load(bytes)).getTitle(), "Quote Q-001");
});

Deno.test("REQ-204 receipt PDF: names the invoice INV-5000 and the snapshotted customer", async () => {
  const invoice = invoiceFixture({
    status: "paid",
    paidAt: "2026-10-20T12:00:00Z",
    paidCents: 97_43,
  });
  const bytes = await new RenderReceiptPdf().run({
    invoice,
    customer: liveCustomer,
    contractor: sender,
    businessName: BIZ,
    method: "zelle",
    confirmedAt: "2026-10-20T12:00:00Z",
  });
  const text = await drawnText(bytes);
  assertStringIncludes(text, "INV-5000");
  assert(!text.includes(invoice.id.slice(0, 8).toUpperCase()), "no id slice");
  assertStringIncludes(text, SNAPSHOT_NAME);
  assert(!text.includes(LIVE_NAME));
  assertEquals(
    (await PDFDocument.load(bytes)).getTitle(),
    "Receipt for INV-5000",
  );
});

// ---------------------------------------------------------------------------
// emails (pure builders)
// ---------------------------------------------------------------------------

Deno.test("REQ-204 REQ-201 email subjects: 'Invoice INV-5000 from <Business>', 'Quote Q-001 from <Business>', the paid variant, 'Version N' on a revision — in both languages", () => {
  const inv = invoiceFixture();
  assertStringIncludes(
    renderInvoiceSubject(inv, sender, "en", bizOf("en")),
    "Invoice INV-5000 from A2Z Landscape LLC",
  );
  assertStringIncludes(
    renderInvoiceSubject(inv, sender, "es", bizOf("es")),
    "Factura INV-5000 de A2Z Landscape LLC",
  );
  assertStringIncludes(
    renderInvoiceSubject(
      invoiceFixture({ version: 2 }),
      sender,
      "en",
      bizOf("en"),
    ),
    "Version 2",
  );
  assertStringIncludes(
    renderInvoiceSubject(
      invoiceFixture({ version: 3 }),
      sender,
      "es",
      bizOf("es"),
    ),
    "Versión 3",
  );
  const paid = renderInvoicePaidSubject(
    invoiceFixture({ status: "paid" }),
    bizOf("en"),
    sender,
    "en",
  );
  assertStringIncludes(paid, "Paid");
  assertStringIncludes(paid, "INV-5000");
  assert(!paid.includes("#"), `no '#' before a document number: ${paid}`);
  const q = quoteFixture();
  assertStringIncludes(
    renderQuoteSubject(q, sender, bizOf("en"), liveCustomer),
    "Quote Q-001 from A2Z Landscape LLC",
  );
  assertStringIncludes(
    renderQuoteSubject(q, sender, bizOf("es"), liveCustomer),
    "Cotización Q-001 de A2Z Landscape LLC",
  );
  assertStringIncludes(
    renderQuoteSubject(
      quoteFixture({ version: 2 }),
      sender,
      bizOf("en"),
      liveCustomer,
    ),
    "Version 2",
  );
  for (
    const s of [
      renderInvoiceSubject(inv, sender, "en", bizOf("en")),
      renderQuoteSubject(q, sender, bizOf("en"), liveCustomer),
    ]
  ) {
    assert(
      !s.includes(inv.id.slice(0, 8)) && !s.includes(q.id.slice(0, 8)),
      `no id slice in a subject: ${s}`,
    );
  }
});

Deno.test("REQ-204 REQ-201 invoice email body: number + version + revised line, snapshotted customer, REQ-206 fields, original quote; PAID / partial / overpaid states", () => {
  const quote = quoteFixture({
    status: "accepted",
    acceptedAt: "2026-10-02T15:00:00Z",
  });
  const html = renderInvoiceHtml(
    invoiceFixture({ version: 2 }),
    liveCustomer,
    sender,
    bizOf("en"),
    quote,
  );
  assertStringIncludes(html, "INV-5000");
  assertStringIncludes(html, "Version 2");
  assertStringIncludes(html, "Revised invoice — replaces previous version");
  assertStringIncludes(html, "Randall");
  assert(
    !html.includes("Someone"),
    "the live record never rewrites an issued bill",
  );
  assertStringIncludes(html, "8.25%");
  assertStringIncludes(html, "Loyalty");
  assertStringIncludes(html, "Zelle to 555-0100");
  assertStringIncludes(html, "725 Frederick Rd");
  assertStringIncludes(html, "Original quote");
  assertStringIncludes(html, "Q-001");
  assert(
    !html.includes(`#${invoiceFixture().id.slice(0, 8).toUpperCase()}`),
    "no id slice",
  );

  // the standalone (no quote) shape renders the same facts
  const basic = renderInvoiceHtml(
    invoiceFixture({ quoteId: undefined }),
    liveCustomer,
    sender,
    bizOf("en"),
  );
  assertStringIncludes(basic, "INV-5000");
  assertStringIncludes(basic, "8.25%");
  assertStringIncludes(basic, "Zelle to 555-0100");
  assertStringIncludes(basic, "725 Frederick Rd");
  assertStringIncludes(basic, "Randall");
  assert(!basic.includes("Someone"));

  const es = renderInvoiceHtml(
    invoiceFixture({ version: 2 }),
    liveCustomer,
    sender,
    bizOf("es"),
    quote,
  );
  assertStringIncludes(es, "Versión 2");
  assertStringIncludes(es, "Factura revisada — reemplaza la versión anterior");

  const paid = renderInvoiceHtml(
    invoiceFixture({
      status: "paid",
      paidAt: "2026-10-20T12:00:00Z",
      paidCents: 97_43,
    }),
    liveCustomer,
    sender,
    bizOf("en"),
    quote,
    true,
  );
  assertStringIncludes(paid, "PAID");
  const partial = renderInvoiceHtml(
    invoiceFixture({ amount: 100_00, paidCents: 40_00 }),
    liveCustomer,
    sender,
    bizOf("en"),
    quote,
  );
  assertStringIncludes(partial, "Paid $40.00 · Balance $60.00");
  const over = renderInvoiceHtml(
    invoiceFixture({
      amount: 100_00,
      paidCents: 105_00,
      overpaidCents: 5_00,
      status: "paid",
      paidAt: "2026-10-20T12:00:00Z",
    }),
    liveCustomer,
    sender,
    bizOf("en"),
    quote,
    true,
  );
  assertStringIncludes(over, "Overpaid by $5.00");
});

Deno.test("REQ-204 REQ-201 quote email body: 'Q-001 · Version 2', the revised line, the snapshotted customer", () => {
  const html = renderQuoteHtml(
    quoteFixture({ version: 2 }),
    liveCustomer,
    sender,
    bizOf("en"),
  );
  assertStringIncludes(html, "Q-001");
  assertStringIncludes(html, "Version 2");
  assertStringIncludes(html, "Revised quote — replaces previous version");
  assertStringIncludes(html, "Randall");
  assert(!html.includes("Someone"));
  assert(
    !html.includes(`#${quoteFixture().id.slice(0, 8).toUpperCase()}`),
    "no id slice",
  );
  const es = renderQuoteHtml(
    quoteFixture({ version: 2 }),
    liveCustomer,
    sender,
    bizOf("es"),
  );
  assertStringIncludes(
    es,
    "Cotización revisada — reemplaza la versión anterior",
  );
});

// ---------------------------------------------------------------------------
// SMS + receipt
// ---------------------------------------------------------------------------

Deno.test("REQ-204 REQ-201 SMS bodies name the document (INV-5000 / Q-001 · Version 2) and greet the snapshotted customer", () => {
  const inv = renderInvoiceBody(
    invoiceFixture({ version: 2 }),
    liveCustomer,
    sender,
    "https://x/s/abc",
    "en",
  );
  assertStringIncludes(inv, "INV-5000");
  assertStringIncludes(inv, "Version 2");
  assertStringIncludes(inv, "Randall");
  assert(!inv.includes("Someone"));
  const invEs = renderInvoiceBody(
    invoiceFixture(),
    liveCustomer,
    sender,
    "https://x/s/abc",
    "es",
  );
  assertStringIncludes(invEs, "Factura INV-5000");
  const q = renderQuoteBody(
    quoteFixture({ version: 2 }),
    liveCustomer,
    sender,
    bizOf("en"),
    "https://x/s/q",
  );
  assertStringIncludes(q, "Q-001");
  assertStringIncludes(q, "Version 2");
  assertStringIncludes(q, "Randall");
  assert(!q.includes("Someone"));
});

Deno.test("REQ-204 receipt email: subject 'Receipt for INV-5000' (es 'Recibo de INV-5000'), body names the invoice", () => {
  const inv = invoiceFixture({
    status: "paid",
    paidAt: "2026-10-20T12:00:00Z",
  });
  assertEquals(renderReceiptSubject(inv, "en"), "Receipt for INV-5000");
  assertEquals(renderReceiptSubject(inv, "es"), "Recibo de INV-5000");
  const html = renderReceiptHtml({
    invoice: inv,
    customer: liveCustomer,
    contractor: sender,
    businessName: BIZ,
    intent: { method: "zelle" },
    amount: 97_43,
    lang: "en",
  });
  assertStringIncludes(html, "INV-5000");
  assertStringIncludes(html, "Randall");
  assert(!html.includes("Someone"));
});

// ---------------------------------------------------------------------------
// alerts (run through the coordinators with captured transports)
// ---------------------------------------------------------------------------

function capture() {
  const email = new EmailService();
  const sms = new SmsService();
  const emails: SendEmailInput[] = [];
  const texts: SendSmsInput[] = [];
  email.send = (input: SendEmailInput) => {
    emails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  sms.send = (input: SendSmsInput) => {
    texts.push(input);
    return Promise.resolve({ ok: true });
  };
  return { email, sms, emails, texts };
}

Deno.test("REQ-204 change-order alert: every email and text names 'CO-001 on INV-5000' (customer copy and contractor copy)", async () => {
  await withKv(async () => {
    const invoices = new InvoiceStore();
    const changeOrders = new ChangeOrderStore();
    const customers = new CustomerStore();
    const identities = new BusinessIdentityStore();
    await seedContractor();
    await identities.upsert(USER, { businessName: BIZ });
    const customer = await customers.create(USER, {
      name: SNAPSHOT_NAME,
      email: "rb@acme.test",
      phoneNumber: "+15125550222",
    });
    const invoice = await invoices.create(USER, {
      customerId: customer.id,
      status: "sent",
      amount: 100_00,
      jobName: "Patio",
    });
    await patchRow<Invoice>(["invoice", invoice.id], { number: "INV-5000" });
    const co = await changeOrders.create(USER, invoice.id, {
      description: "Second coat",
      deltaAmountCents: 25_00,
      customerId: customer.id,
    });
    assertEquals(co.number, "CO-001");
    await customers.update(customer.id, USER, { name: LIVE_NAME });
    const { email, sms, emails, texts } = capture();
    const res = await new SendChangeOrderAlert(
      changeOrders,
      customers,
      new UserStore(),
      identities,
      email,
      sms,
      invoices,
    ).run(co.id);
    assertEquals(res.ok, true);
    assertEquals(emails.length, 2, "customer + contractor emails");
    assertEquals(texts.length, 2, "customer + contractor texts");
    for (const e of emails) {
      assertStringIncludes(e.subject, "CO-001 on INV-5000");
      assertStringIncludes(e.htmlBody, "CO-001 on INV-5000");
    }
    for (const s of texts) assertStringIncludes(s.body, "CO-001 on INV-5000");
    const contractorCopy = emails.find((e) => e.to === "me@test.dev")!;
    assertStringIncludes(contractorCopy.subject, SNAPSHOT_NAME);
    assert(
      !contractorCopy.subject.includes(LIVE_NAME),
      "the change order names the customer as snapshotted",
    );
  });
});

Deno.test("REQ-204 accepted alert: the contractor's email and text name the quote Q-001 and the customer as snapshotted", async () => {
  await withKv(async () => {
    const quotes = new QuoteStore();
    const customers = new CustomerStore();
    await seedContractor();
    const customer = await customers.create(USER, {
      name: SNAPSHOT_NAME,
      email: "rb@acme.test",
    });
    const quote = await quotes.create(USER, {
      customerId: customer.id,
      summary: "Patio",
      lineItems: [],
      status: "accepted",
      acceptedAt: "2026-10-02T15:00:00Z",
    });
    assertEquals(quote.number, "Q-001");
    await customers.update(customer.id, USER, { name: LIVE_NAME });
    const { email, sms, emails, texts } = capture();
    const flow = new SendAcceptedAlert(
      quotes,
      customers,
      new UserStore(),
      email,
      sms,
      new LogPaperworkMessage(
        new CommConversationStore(),
        new CommMessageStore(),
      ),
    );
    const res = await flow.run(quote.id);
    assertEquals(res.ok, true);
    assertEquals(emails.length, 1);
    assertStringIncludes(emails[0].subject, "Q-001");
    assertStringIncludes(emails[0].htmlBody, "Q-001");
    assertStringIncludes(emails[0].htmlBody, SNAPSHOT_NAME);
    assert(!emails[0].htmlBody.includes(LIVE_NAME));
    assertEquals(texts.length, 1);
    assertStringIncludes(texts[0].body, "Q-001");
  });
});
