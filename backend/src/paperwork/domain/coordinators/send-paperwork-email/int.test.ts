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
import { ReplyTokenStore } from "@paperwork/domain/data/reply-token-store/mod.ts";

interface SetupResult {
  flow: SendPaperworkEmail;
  customers: CustomerStore;
  quotes: QuoteStore;
  invoices: InvoiceStore;
  identities: BusinessIdentityStore;
  email: EmailService;
  sent: SendEmailInput[];
}

function fresh(): SetupResult {
  const customers = new CustomerStore();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const identities = new BusinessIdentityStore();
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
    identities,
    email,
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    ),
  );
  return { flow, customers, quotes, invoices, identities, email, sent };
}

// REQ-123 — "i do not want to SEND ANYTHING VIA monsterrg.com can we send everything via
// documonster instead?" — a contractor's paperwork leaves from their alias at documonster.com,
// and from noreply@documonster.com when no business name has made an alias yet.
Deno.test("REQ-123 send-paperwork-email: a quote leaves from <alias>@documonster.com — the business name's slug — and from noreply@documonster.com with no business identity on file", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, identities, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", { name: "Acme", email: "ops@acme.test" });
  const quote = await quotes.create("u-1", { customerId: customer.id, summary: "Job", lineItems: [] });

  const bare = await flow.run("u-1", { kind: "quote", resourceId: quote.id });
  assertEquals(bare.ok, true);
  assertEquals(sent[0].from, "noreply@documonster.com");

  const identity = await identities.upsert("u-1", { businessName: "Demo Roofing LLC" });
  assertEquals(identity.emailAlias, "demo-roofing-llc");
  const aliased = await flow.run("u-1", { kind: "quote", resourceId: quote.id });
  assertEquals(aliased.ok, true);
  assertEquals(sent[1].from, "demo-roofing-llc@documonster.com");

  await resetKv();
});

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
  // REQ-337: an intra-word hyphen keeps its compound whole ("Tear-off")
  assertStringIncludes(sent[0].subject, "Roof Tear-off");
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
  // REQ-204: the subject names the document — "Quote Q-001 from <Business>".
  assertStringIncludes(sent[0].subject, "Quote Q-001 from");
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

// REQ-020 — NW-29 (p28): "When an invoice is paid it must also be emailed to
// the Unicorn with 'Paid' on it so everyone is on the same page."
Deno.test("REQ-020 NW-29 send-paperwork-email integration: variant 'paid' emails the invoice stamped PAID — subject says Paid, money card is not AMOUNT DUE", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, invoices, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", { name: "Acme", email: "ops@acme.test" });
  const quote = await quotes.create("u-1", {
    summary: "Patio",
    lineItems: [{ description: "Patio pavers", quantity: 1, unit: "job", price: 999_00 }],
    estimatedTotal: 999_00,
    customerId: customer.id,
  });
  const invoice = await invoices.create("u-1", {
    quoteId: quote.id,
    customerId: customer.id,
    dueDate: "2026-05-01",
    amount: 999_00,
    status: "paid",
    paidAt: "2026-04-20T12:00:00.000Z",
  });

  const res = await flow.run("u-1", { kind: "invoice", resourceId: invoice.id, variant: "paid" });
  assertEquals(res.ok, true);
  assertStringIncludes(res.subject, "Paid");
  assertStringIncludes(sent[0].subject, "Paid");
  assertStringIncludes(sent[0].htmlBody, "PAID");
  assert(!sent[0].htmlBody.includes("AMOUNT DUE"), "no AMOUNT DUE on a paid invoice");
  assert(!/amount due/i.test(sent[0].htmlBody), "no 'Amount due' label on a paid invoice");
  assertStringIncludes(sent[0].htmlBody, "$999.00");
  await resetKv();
});

Deno.test("REQ-020 NW-29 send-paperwork-email integration: the paid variant of a standalone (no-quote) invoice also says Paid", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, invoices, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", { name: "Acme", email: "ops@acme.test" });
  const invoice = await invoices.create("u-1", {
    customerId: customer.id,
    dueDate: "2026-05-01",
    amount: 450_00,
    status: "paid",
    paidAt: "2026-04-20T12:00:00.000Z",
  });
  await flow.run("u-1", { kind: "invoice", resourceId: invoice.id, variant: "paid" });
  assertStringIncludes(sent[0].subject, "Paid");
  assert(!/amount due/i.test(sent[0].htmlBody), "no 'Amount due' label on a paid invoice");
  assertStringIncludes(sent[0].htmlBody, "PAID");
  await resetKv();
});

// REQ-160 — Raphael, previewing A2Z's October batch in his inbox: "these have the paperwork
// monster on it not the client logo in this case a2z logo"
Deno.test("REQ-160 send-paperwork-email: a standalone invoice's email carries the contractor's logo (the public-logo URL) once one is on file, and the house logo until then", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, invoices, identities, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", { name: "Randall Belknap", email: "rb@acme.test" });
  const invoice = await invoices.create("u-1", { customerId: customer.id, status: "draft", jobName: "Maintenance", amount: 35750, lineItems: [{ description: "Oct 2 — Lawn", quantity: 1, unit: "visit", price: 6500 }] });

  await identities.upsert("u-1", { businessName: "A2Z Landscape LLC" });
  const before = await flow.run("u-1", { kind: "invoice", resourceId: invoice.id });
  assertEquals(before.ok, true);
  assertStringIncludes(sent[0].htmlBody, "/logo-email.png");
  assert(!sent[0].htmlBody.includes("/api/public-logo/"), "no business logo yet → no public-logo URL");

  await identities.upsert("u-1", { logoFileId: "file-a2z" });
  const after = await flow.run("u-1", { kind: "invoice", resourceId: invoice.id });
  assertEquals(after.ok, true);
  assertStringIncludes(sent[1].htmlBody, `/api/public-logo/invoice/${invoice.id}`);
  assertStringIncludes(sent[1].htmlBody, 'alt="A2Z Landscape LLC"');
  assert(!sent[1].htmlBody.includes("/logo-email.png"), "the house logo makes way for the business's");

  await resetKv();
});

// REQ-168 — "we need to collect a customer web page so we can attach it to invoices also"
// REQ-169 — "invoices should say instead of 'thank you for the work' really make this wording pretty"
Deno.test("REQ-168/169 send-paperwork-email: a standalone invoice's email links the business website in its From block and opens by thanking the customer for trusting the business", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, invoices, identities, sent } = fresh();
  await seedContractor("u-1");
  await identities.upsert("u-1", { businessName: "A2Z Landscape LLC", websiteUrl: "https://a2zlandscape.com/" });
  const customer = await customers.create("u-1", { name: "Randall Belknap", email: "rb@acme.test" });
  const invoice = await invoices.create("u-1", { customerId: customer.id, status: "draft", jobName: "Maintenance", amount: 35750 });
  const r = await flow.run("u-1", { kind: "invoice", resourceId: invoice.id });
  assertEquals(r.ok, true);
  const html = sent[0].htmlBody;
  assertStringIncludes(html, 'href="https://a2zlandscape.com/"');
  assertStringIncludes(html, ">a2zlandscape.com<");
  assertStringIncludes(html, "Thank you for trusting A2Z Landscape LLC");
  assert(!html.includes("Thanks for the work"), "the old intro is gone");
  await resetKv();
});

// REQ-173 — "on invoices can we make the address a heading and then detail the date and the service?"
Deno.test("REQ-173 send-paperwork-email: a batch invoice's email shows the address as a heading with one row per visit (date · service · price), not the flat 'date — service — address' lines", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, invoices, identities, sent } = fresh();
  await seedContractor("u-1");
  await identities.upsert("u-1", { businessName: "A2Z Landscape LLC" });
  const customer = await customers.create("u-1", { name: "Randall Belknap", email: "rb@acme.test" });
  const addr = "725 Frederick Rd, Rockingham, VA 22801-1306";
  const invoice = await invoices.create("u-1", {
    customerId: customer.id,
    status: "draft",
    jobName: "Maintenance 2026-10-01 → 2026-10-31",
    description: `Oct 2 — Lawn — ${addr}\nOct 9 — Lawn — ${addr}`,
    lineItems: [
      { description: `Oct 2 — Lawn — ${addr}`, quantity: 1, unit: "visit", price: 6500, date: "2026-10-02", service: "Lawn", address: addr },
      { description: `Oct 9 — Lawn — ${addr}`, quantity: 1, unit: "visit", price: 6500, date: "2026-10-09", service: "Lawn", address: addr },
    ],
    amount: 13000,
  });
  const r = await flow.run("u-1", { kind: "invoice", resourceId: invoice.id });
  assertEquals(r.ok, true);
  const html = sent[0].htmlBody;
  assertStringIncludes(html, 'data-visit-address');
  assertStringIncludes(html, addr);
  assertStringIncludes(html, "Oct 2");
  assertStringIncludes(html, "Oct 9");
  assertStringIncludes(html, "$65.00");
  assert(!html.includes(`Oct 2 — Lawn — ${addr}`), "the flat line is replaced by the grouped visits");
  await resetKv();
});

// REQ-175 — "when a customers customer replies to an invoice it should go to the customer inbox"
Deno.test("REQ-175 send-paperwork-email: the invoice email carries Reply-To reply+<token>@inbound.documonster.com, the token resolving to this contractor and customer and reused on the next send", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("INBOUND_MAIL_DOMAIN");
  await resetKv();
  const { flow, customers, invoices, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", { name: "Randall Belknap", email: "rb@acme.test" });
  const invoice = await invoices.create("u-1", { customerId: customer.id, status: "draft", jobName: "Maintenance", amount: 100 });
  assertEquals((await flow.run("u-1", { kind: "invoice", resourceId: invoice.id })).ok, true);
  const replyTo = sent[0].replyTo ?? "";
  const m = /^reply\+([a-z0-9]+)@inbound\.documonster\.com$/.exec(replyTo);
  assert(m, `Reply-To is reply+<token>@inbound.documonster.com (${replyTo})`);
  const owner = await new ReplyTokenStore().resolve(m![1]);
  assertEquals([owner?.userId, owner?.customerId], ["u-1", customer.id]);
  assertEquals((await flow.run("u-1", { kind: "invoice", resourceId: invoice.id })).ok, true);
  assertEquals(sent[1].replyTo, replyTo, "the same token next time");
  assertEquals(await new ReplyTokenStore().resolve("nope00"), null);
  await resetKv();
});

// REQ-204 / REQ-201 — the dispatched invoice email names the bill by number
// and version and shows the customer as snapshotted when it was issued.
Deno.test("REQ-204 send-paperwork-email: a sent invoice's email says 'Invoice INV-001 from <Business>' and keeps the snapshotted customer after a CRM rename", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, invoices, identities, sent } = fresh();
  await seedContractor("u-1");
  await identities.upsert("u-1", { businessName: "A2Z Landscape LLC" });
  const customer = await customers.create("u-1", { name: "Randall Belknap", email: "rb@acme.test" });
  const invoice = await invoices.create("u-1", { customerId: customer.id, status: "sent", jobName: "Maintenance", amount: 35750, dueDate: "2026-11-15" });
  assertEquals(invoice.number, "INV-001");
  await customers.update(customer.id, "u-1", { name: "Someone Else" });
  const r = await flow.run("u-1", { kind: "invoice", resourceId: invoice.id });
  assertEquals(r.ok, true);
  assertStringIncludes(sent[0].subject, "Invoice INV-001 from A2Z Landscape LLC");
  assert(!sent[0].subject.includes(invoice.id.slice(0, 8)), "no id slice in the subject");
  assertStringIncludes(sent[0].htmlBody, "INV-001");
  assert(!sent[0].htmlBody.includes(`#${invoice.id.slice(0, 8).toUpperCase()}`), "no id slice in the body");
  assertStringIncludes(sent[0].htmlBody, "Randall");
  assert(!sent[0].htmlBody.includes("Someone"), "the renamed live record does not rewrite an issued bill");
  await resetKv();
});

// REQ-342 (demo-loop cycle 1, M13): the CTA link carries the send language,
// so a cookie-less customer opens the quote in the language it was sent in.
Deno.test("REQ-342 send-paperwork-email: a Spanish send's CTA is /q/<id>?lang=es; a send with no pick carries the resolved default, ?lang=en", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, quotes, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", {
    name: "Juan",
    email: "juan@acme.test",
  });
  const quote = await quotes.create("u-1", {
    customerId: customer.id,
    summary: "Pintar el baño",
    lineItems: [{ description: "Pintura", quantity: 1, unit: "ea", price: 500 }],
    estimatedTotal: 500,
  });

  const es = await flow.run("u-1", {
    kind: "quote",
    resourceId: quote.id,
    language: "es",
  });
  assertEquals(es.ok, true);
  assertStringIncludes(sent[0].htmlBody, `/q/${quote.id}?lang=es`);
  assert(
    !sent[0].htmlBody.includes(`/q/${quote.id}"`),
    "no bare /q link remains in the Spanish email",
  );

  await resetKv();
  const bare = fresh();
  await seedContractor("u-2");
  const c2 = await bare.customers.create("u-2", {
    name: "Ann",
    email: "ann@acme.test",
  });
  const q2 = await bare.quotes.create("u-2", {
    customerId: c2.id,
    summary: "Roof",
    lineItems: [{ description: "Demo", quantity: 1, unit: "ea", price: 500 }],
    estimatedTotal: 500,
  });
  const r2 = await bare.flow.run("u-2", { kind: "quote", resourceId: q2.id });
  assertEquals(r2.ok, true);
  // UX-28: the coordinator always resolves ONE send language (pick → stored
  // default → en); the link names what the email went out in.
  assertStringIncludes(bare.sent[0].htmlBody, `/q/${q2.id}?lang=en`);
  assert(
    !bare.sent[0].htmlBody.includes("?lang=es"),
    "an English send never points the customer at the Spanish document",
  );
  await resetKv();
});

// REQ-480 (demo-loop cycle 3, M18): "Issue invoice" no longer stamps "sent"
// before anything was delivered. An unissued (draft / scheduled) invoice
// becomes "sent" only when a channel actually delivers it — the email it goes
// out in already reads "Sent" — and stays unissued when nothing went.
Deno.test("REQ-480 M18 send-paperwork-email: a draft invoice that is emailed becomes sent (sentAt stamped) and its email reads Sent, never Draft", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, invoices, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", { name: "Ana", email: "ana@acme.test" });
  const invoice = await invoices.create("u-1", {
    customerId: customer.id,
    dueDate: "2099-01-01",
    amount: 120_000,
    status: "draft",
  });

  const r = await flow.run("u-1", { kind: "invoice", resourceId: invoice.id });
  assertEquals(r.ok, true, r.reason);
  assert(!/>\s*Draft\s*</.test(sent[0].htmlBody), "the email never reads Draft");
  assertStringIncludes(sent[0].htmlBody, "Sent");
  const after = await invoices.getOwned(invoice.id, "u-1");
  assertEquals(after.status, "sent");
  assert(after.sentAt, "sentAt stamped on delivery");
  await resetKv();
});

Deno.test("REQ-480 M18 send-paperwork-email: a scheduled invoice sent now becomes sent once the email delivers", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, invoices } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", { name: "Ana", email: "ana@acme.test" });
  const invoice = await invoices.create("u-1", {
    customerId: customer.id,
    dueDate: "2099-01-01",
    amount: 120_000,
    status: "scheduled",
    scheduledFor: "2099-01-01",
  });
  const r = await flow.run("u-1", { kind: "invoice", resourceId: invoice.id });
  assertEquals(r.ok, true, r.reason);
  assertEquals((await invoices.getOwned(invoice.id, "u-1")).status, "sent");
  await resetKv();
});

Deno.test("REQ-480 M18 send-paperwork-email: a draft invoice with no email on file stays a draft — nothing delivered, nothing stamped", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, invoices, sent } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", { name: "Ana" });
  const invoice = await invoices.create("u-1", {
    customerId: customer.id,
    dueDate: "2099-01-01",
    amount: 120_000,
    status: "draft",
  });
  const r = await flow.run("u-1", { kind: "invoice", resourceId: invoice.id });
  assertEquals(r.ok, false);
  assertEquals(sent.length, 0);
  const after = await invoices.getOwned(invoice.id, "u-1");
  assertEquals(after.status, "draft");
  assertEquals(after.sentAt, undefined);
  await resetKv();
});

Deno.test("REQ-480 M18 send-paperwork-email: re-emailing an already viewed invoice never moves its status back to sent", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, customers, invoices } = fresh();
  await seedContractor("u-1");
  const customer = await customers.create("u-1", { name: "Ana", email: "ana@acme.test" });
  const invoice = await invoices.create("u-1", {
    customerId: customer.id,
    dueDate: "2099-01-01",
    amount: 120_000,
    status: "viewed",
  });
  const r = await flow.run("u-1", { kind: "invoice", resourceId: invoice.id });
  assertEquals(r.ok, true, r.reason);
  assertEquals((await invoices.getOwned(invoice.id, "u-1")).status, "viewed");
  await resetKv();
});
