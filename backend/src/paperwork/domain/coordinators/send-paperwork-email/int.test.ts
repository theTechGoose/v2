import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { SendPaperworkEmail } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { EmailService, type SendEmailInput } from "@communication/domain/data/email-service/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

interface SetupResult {
  flow: SendPaperworkEmail;
  customers: CustomerStore;
  quotes: QuoteStore;
  contracts: ContractStore;
  invoices: InvoiceStore;
  email: EmailService;
  sent: SendEmailInput[];
}

function fresh(): SetupResult {
  const customers = new CustomerStore();
  const quotes    = new QuoteStore();
  const contracts = new ContractStore();
  const invoices  = new InvoiceStore();
  const email     = new EmailService();
  const sent: SendEmailInput[] = [];
  // EmailService runs in dev-mode (no POSTMARK_API_KEY) — short-circuit and
  // capture in-memory instead.
  const original = email.send.bind(email);
  email.send = async (input: SendEmailInput) => {
    sent.push(input);
    return { ok: true, reason: "test_capture" };
  };
  void original;
  const flow = new SendPaperworkEmail(quotes, contracts, invoices, customers, email);
  return { flow, customers, quotes, contracts, invoices, email, sent };
}

Deno.test("send-paperwork-email integration: dispatches a quote to the linked customer's email", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, sent } = fresh();
  const customer = await customers.create("u-1", { name: "Acme", email: "ops@acme.test" });
  const quote = await quotes.create("u-1", {
    customerId: customer.id, summary: "Roof tear-off",
    lineItems: [{ description: "Demo", quantity: 1, unit: "ea", price: 500 }],
    estimatedTotal: 500,
  });

  const result = await flow.run("u-1", { kind: "quote", resourceId: quote.id });
  assertEquals(result.ok, true);
  assertEquals(result.to, "ops@acme.test");
  assertEquals(sent.length, 1);
  assertStringIncludes(sent[0].subject, "Roof tear-off");
  assertStringIncludes(sent[0].htmlBody, "Demo");

  await resetKv();
});

Deno.test("send-paperwork-email integration: explicit `to` overrides the linked customer email", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, sent } = fresh();
  const customer = await customers.create("u-1", { name: "Acme", email: "ops@acme.test" });
  const quote = await quotes.create("u-1", {
    customerId: customer.id, summary: "Job", lineItems: [],
  });

  const result = await flow.run("u-1", { kind: "quote", resourceId: quote.id, to: "elsewhere@acme.test" });
  assertEquals(result.to, "elsewhere@acme.test");
  assertEquals(sent[0].to, "elsewhere@acme.test");

  await resetKv();
});

Deno.test("send-paperwork-email integration: returns ok=false when no recipient resolvable", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, quotes, sent } = fresh();
  const quote = await quotes.create("u-1", { summary: "Orphan quote", lineItems: [] });

  const result = await flow.run("u-1", { kind: "quote", resourceId: quote.id });
  assertEquals(result.ok, false);
  assertStringIncludes(result.reason ?? "", "no recipient");
  assertEquals(sent.length, 0);

  await resetKv();
});

Deno.test("send-paperwork-email integration: contract dispatch renders status + total", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, contracts, sent } = fresh();
  const customer = await customers.create("u-1", { name: "Acme", email: "ops@acme.test" });
  const quote = await quotes.create("u-1", { summary: "x", lineItems: [], customerId: customer.id });
  const contract = await contracts.create("u-1", {
    quoteId: quote.id, customerId: customer.id, status: "draft", totalAmount: 1234,
  });

  await flow.run("u-1", { kind: "contract", resourceId: contract.id });
  assertStringIncludes(sent[0].subject, "Contract ready");
  assertStringIncludes(sent[0].htmlBody, "$1234.00");
  assertStringIncludes(sent[0].htmlBody, "draft");

  await resetKv();
});

Deno.test("send-paperwork-email integration: invoice dispatch renders amount + due date", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, contracts, invoices, sent } = fresh();
  const customer = await customers.create("u-1", { name: "Acme", email: "ops@acme.test" });
  const quote = await quotes.create("u-1", { summary: "x", lineItems: [], customerId: customer.id });
  const contract = await contracts.create("u-1", { quoteId: quote.id, customerId: customer.id });
  const invoice = await invoices.create("u-1", {
    contractId: contract.id, customerId: customer.id, dueDate: "2026-05-01",
    amount: 999, status: "pending",
  });

  await flow.run("u-1", { kind: "invoice", resourceId: invoice.id });
  assertStringIncludes(sent[0].subject, "Invoice");
  assertStringIncludes(sent[0].subject, "2026-05-01");
  assertStringIncludes(sent[0].htmlBody, "$999.00");

  await resetKv();
});

Deno.test("send-paperwork-email integration: quote html escapes user-supplied summary + line items", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, sent } = fresh();
  const customer = await customers.create("u-1", { name: "Acme", email: "ops@acme.test" });
  const quote = await quotes.create("u-1", {
    customerId: customer.id,
    summary: `<script>alert("xss")</script>`,
    lineItems: [
      { description: `Demolish & "haul"`, quantity: 1, unit: "<ea>", price: 500 },
    ],
    estimatedTotal: 500,
  });

  await flow.run("u-1", { kind: "quote", resourceId: quote.id });
  const html = sent[0].htmlBody;
  // Raw markup must not survive — every special char escaped.
  assert(!html.includes("<script>"), "raw <script> tag must not appear in rendered html");
  assertStringIncludes(html, "&lt;script&gt;");
  assertStringIncludes(html, "&amp;");      // & in description
  assertStringIncludes(html, "&quot;");     // " in description
  assertStringIncludes(html, "&lt;ea&gt;"); // unit angle brackets
  await resetKv();
});

Deno.test("send-paperwork-email integration: contract html escapes user-supplied status", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, contracts, sent } = fresh();
  const customer = await customers.create("u-1", { name: "Acme", email: "ops@acme.test" });
  const quote = await quotes.create("u-1", { summary: "x", lineItems: [], customerId: customer.id });
  const contract = await contracts.create("u-1", {
    quoteId: quote.id, customerId: customer.id,
    status: `<img src=x onerror=alert(1)>`,
    totalAmount: 100,
  });

  await flow.run("u-1", { kind: "contract", resourceId: contract.id });
  const html = sent[0].htmlBody;
  assert(!html.includes("<img"), "raw <img> tag must not appear in rendered html");
  assertStringIncludes(html, "&lt;img");
  await resetKv();
});

Deno.test("send-paperwork-email integration: invoice renders em-dash when amount is missing", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, contracts, invoices, sent } = fresh();
  const customer = await customers.create("u-1", { name: "Acme", email: "ops@acme.test" });
  const quote = await quotes.create("u-1", { summary: "x", lineItems: [], customerId: customer.id });
  const contract = await contracts.create("u-1", { quoteId: quote.id, customerId: customer.id });
  // Omit `amount` — render path uses "—" placeholder when not a number.
  const invoice = await invoices.create("u-1", {
    contractId: contract.id, customerId: customer.id, dueDate: "2026-05-01",
  });

  await flow.run("u-1", { kind: "invoice", resourceId: invoice.id });
  assertStringIncludes(sent[0].htmlBody, "Amount due: <strong>—</strong>");
  await resetKv();
});

Deno.test("send-paperwork-email integration: cross-tenant call throws ForbiddenError before dispatch", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, sent } = fresh();
  const customer = await customers.create("u-1", { name: "Acme", email: "x@y.z" });
  const quote = await quotes.create("u-1", { summary: "x", lineItems: [], customerId: customer.id });

  let threw = false;
  try {
    await flow.run("u-2", { kind: "quote", resourceId: quote.id });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
  assertEquals(sent.length, 0);

  await resetKv();
});
