import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { SendPaperworkEmail } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

interface SetupResult {
  flow: SendPaperworkEmail;
  customers: CustomerStore;
  quotes: QuoteStore;
  invoices: InvoiceStore;
  email: EmailService;
  sent: SendEmailInput[];
}

function fresh(): SetupResult {
  const customers = new CustomerStore();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const email = new EmailService();
  const sent: SendEmailInput[] = [];
  // EmailService runs in dev-mode (no POSTMARK_API_KEY) — short-circuit and
  // capture in-memory instead.
  const original = email.send.bind(email);
  email.send = (input: SendEmailInput) => {
    sent.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  void original;
  const flow = new SendPaperworkEmail(
    quotes,
    invoices,
    customers,
    new UserStore(),
    new BusinessIdentityStore(),
    email,
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    ),
  );
  return { flow, customers, quotes, invoices, email, sent };
}

/** P-06: outbound dispatch refuses without a real contractor name on file.
 *  UserStore.create() assigns a random id, so write the user row directly. */
async function seedContractor(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550000",
    name: "Test Contractor",
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  });
}

Deno.test("send-paperwork-email integration: dispatches a quote to the linked customer's email with the /q accept CTA", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", {
    name: "Acme",
    email: "ops@acme.test",
  });
  const quote = await quotes.create("u-1", {
    customerId: customer.id,
    summary: "Roof tear-off",
    // Two line items so the breakdown table renders (a single-line quote
    // intentionally hides the table — the total card already covers it).
    lineItems: [
      { description: "Demo", quantity: 1, unit: "ea", price: 500 },
      { description: "Haul-away", quantity: 1, unit: "ea", price: 250 },
    ],
    estimatedTotal: 750,
  });

  const result = await flow.run("u-1", { kind: "quote", resourceId: quote.id });
  assertEquals(result.ok, true);
  assertEquals(result.to, "ops@acme.test");
  assertEquals(sent.length, 1);
  // QuoteStore now auto-derives a ≤3-word jobName from the summary
  // (roadmap p.8), and the subject renders the jobName.
  assertStringIncludes(sent[0].subject, "Roof Tear Off");
  assertStringIncludes(sent[0].htmlBody, "Demo");
  // The quote IS the agreement: the one email carries the review-and-accept
  // CTA pointing at the public /q page.
  assertStringIncludes(sent[0].htmlBody, `/q/${quote.id}`);

  await resetKv();
});

Deno.test("send-paperwork-email integration: explicit `to` overrides the linked customer email", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", {
    name: "Acme",
    email: "ops@acme.test",
  });
  const quote = await quotes.create("u-1", {
    customerId: customer.id,
    summary: "Job",
    lineItems: [],
  });

  const result = await flow.run("u-1", {
    kind: "quote",
    resourceId: quote.id,
    to: "elsewhere@acme.test",
  });
  assertEquals(result.to, "elsewhere@acme.test");
  assertEquals(sent[0].to, "elsewhere@acme.test");

  await resetKv();
});

Deno.test("send-paperwork-email integration: returns ok=false when no recipient resolvable", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, quotes, sent } = fresh();
  await seedContractor("u-1");
  const quote = await quotes.create("u-1", {
    summary: "Orphan quote",
    lineItems: [],
  });

  const result = await flow.run("u-1", { kind: "quote", resourceId: quote.id });
  assertEquals(result.ok, false);
  assertStringIncludes(result.reason ?? "", "no recipient");
  assertEquals(sent.length, 0);

  await resetKv();
});

Deno.test("send-paperwork-email integration: quote dispatch is the review-and-sign email carrying the agreement value", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", {
    name: "Acme",
    email: "ops@acme.test",
  });
  // One document, one dispatch: the quote email IS the "review & sign" flow,
  // rendering the quote's total (INTEGER CENTS — audit1 #3).
  const quote = await quotes.create("u-1", {
    summary: "Bathroom remodel",
    lineItems: [],
    estimatedTotal: 1_234_00,
    customerId: customer.id,
  });

  await flow.run("u-1", { kind: "quote", resourceId: quote.id });
  // Quote-framed subject (not "Sign your contract #…") + the agreement value.
  assertStringIncludes(sent[0].subject, "Quote for");
  assertStringIncludes(sent[0].htmlBody, "$1,234.00");

  await resetKv();
});

Deno.test("send-paperwork-email integration: invoice dispatch renders amount + due date", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, invoices, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", {
    name: "Acme",
    email: "ops@acme.test",
  });
  const quote = await quotes.create("u-1", {
    summary: "x",
    lineItems: [],
    customerId: customer.id,
  });
  const invoice = await invoices.create("u-1", {
    quoteId: quote.id,
    customerId: customer.id,
    dueDate: "2026-05-01",
    amount: 999_00,
    status: "pending", // INTEGER CENTS
  });

  await flow.run("u-1", { kind: "invoice", resourceId: invoice.id });
  assertStringIncludes(sent[0].subject, "Invoice");
  // The renderer formats dates as "May 1, 2026" — assert on the formatted form.
  assertStringIncludes(sent[0].subject, "May 1, 2026");
  assertStringIncludes(sent[0].htmlBody, "$999.00");

  await resetKv();
});

Deno.test("send-paperwork-email integration: invoice email links the signed agreement at /q/<quoteId> once accepted", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, invoices, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", {
    name: "Acme",
    email: "ops@acme.test",
  });
  const quote = await quotes.create("u-1", {
    summary: "Deck build",
    lineItems: [],
    customerId: customer.id,
    estimatedTotal: 2_000_00,
    status: "accepted",
    acceptedAt: "2026-04-01T00:00:00Z",
  });
  const invoice = await invoices.create("u-1", {
    quoteId: quote.id,
    customerId: customer.id,
    dueDate: "2026-05-01",
    amount: 1_000_00,
    status: "pending",
  });

  await flow.run("u-1", { kind: "invoice", resourceId: invoice.id });
  assertEquals(sent.length, 1);
  // The signed-agreement link resolves through invoice.quoteId — no contract.
  assertStringIncludes(sent[0].htmlBody, `/q/${quote.id}`);

  await resetKv();
});

Deno.test("send-paperwork-email integration: quote html escapes user-supplied summary + line items", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", {
    name: "Acme",
    email: "ops@acme.test",
  });
  const quote = await quotes.create("u-1", {
    customerId: customer.id,
    summary: `<script>alert("xss")</script>`,
    // Two line items so the breakdown table renders; the first has qty>1 so
    // its (malicious) unit is shown and we can assert it's escaped.
    lineItems: [
      {
        description: `Demolish & "haul"`,
        quantity: 2,
        unit: "<ea>",
        price: 500,
      },
      { description: "Cleanup", quantity: 1, unit: "ea", price: 100 },
    ],
    estimatedTotal: 1_100,
  });

  await flow.run("u-1", { kind: "quote", resourceId: quote.id });
  const html = sent[0].htmlBody;
  // Raw markup from user-supplied fields must not survive — escaped only.
  // The shell wraps everything in a real HTML doc which legitimately
  // includes `<` (`<table>`, `<a>`, …) so check the dangerous-tag form
  // specifically rather than the bare `<` character.
  assert(
    !html.includes("<script>"),
    "raw <script> tag must not appear in rendered html",
  );
  assertStringIncludes(html, "&lt;script&gt;");
  assertStringIncludes(html, "&amp;"); // & in description
  assertStringIncludes(html, "&quot;"); // " in description
  assertStringIncludes(html, "&lt;ea&gt;"); // unit angle brackets
  await resetKv();
});

Deno.test("send-paperwork-email integration: quote email does not leak a user-supplied status as raw markup", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", {
    name: "Acme",
    email: "ops@acme.test",
  });
  const quote = await quotes.create("u-1", {
    summary: "x",
    lineItems: [],
    customerId: customer.id,
    status: `<img src=x onerror=alert(1)>`,
    estimatedTotal: 100,
  });

  await flow.run("u-1", { kind: "quote", resourceId: quote.id });
  const html = sent[0].htmlBody;
  // The quote email intentionally does NOT render the raw status — so a
  // malicious status is never an injection vector.
  assert(
    !html.includes("<img"),
    "raw <img> tag must not appear in rendered html",
  );
  assert(!html.includes("onerror="), "raw status attribute must not leak");
  await resetKv();
});

Deno.test("send-paperwork-email integration: invoice renders em-dash when amount is missing", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, invoices, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", {
    name: "Acme",
    email: "ops@acme.test",
  });
  const quote = await quotes.create("u-1", {
    summary: "x",
    lineItems: [],
    customerId: customer.id,
  });
  // Omit `amount` — render path uses "—" placeholder when not a number.
  const invoice = await invoices.create("u-1", {
    quoteId: quote.id,
    customerId: customer.id,
    dueDate: "2026-05-01",
  });

  await flow.run("u-1", { kind: "invoice", resourceId: invoice.id });
  // Renderer falls back to "—" when amount is not a finite number.
  assertStringIncludes(sent[0].htmlBody, "—");
  await resetKv();
});

Deno.test("send-paperwork-email integration: cross-tenant call throws ForbiddenError before dispatch", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, sent } = fresh();
  await seedContractor("u-1");
  await seedContractor("u-2");
  const customer = await customers.create("u-1", {
    name: "Acme",
    email: "x@y.z",
  });
  const quote = await quotes.create("u-1", {
    summary: "x",
    lineItems: [],
    customerId: customer.id,
  });

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
