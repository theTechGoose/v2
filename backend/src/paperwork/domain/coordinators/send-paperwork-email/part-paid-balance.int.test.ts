/**
 * REQ-1028 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green." LOOP-007 cycle 2:
 *  - q2-9: a reminder (= the invoice send, REQ-924 d) for a part-paid invoice
 *    asks for the full amount and shows "Estado Pending" in a Spanish email.
 *  - q2-20: the Spanish invoice email says "Estado Enviado" while /i says
 *    "Enviada".
 *
 * Through the real path: a $1,190.75 invoice, a $500 payment recorded by
 * ComputeInvoiceBalance (status "pending", paidCents 50000), then
 * SendPaperworkEmail for the invoice in Spanish. The captured htmlBody's
 * money card and preheader must ask for the $690.75 balance, and the
 * Estado cell must be a Spanish invoice word, never "Pending" / "Enviado".
 */
import { assert, assertEquals } from "#std/assert";
import { SendPaperworkEmail } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { ComputeInvoiceBalance } from "@paperwork/domain/coordinators/compute-invoice-balance/mod.ts";
import type { MarkInvoicePaid } from "@paperwork/domain/coordinators/mark-invoice-paid/mod.ts";
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
import { t } from "@core/i18n/mod.ts";

const TOTAL = 119_075; // $1,190.75
const PAID = 50_000; // $500.00
const FULL = "$1,190.75";
const BALANCE = "$690.75";

async function rig() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const customers = new CustomerStore();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const payments = new PaymentStore();
  const identities = new BusinessIdentityStore();
  const email = new EmailService();
  const sent: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    sent.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const flow = new SendPaperworkEmail(
    quotes,
    invoices,
    customers,
    new UserStore(),
    identities,
    email,
    new LogPaperworkMessage(new CommConversationStore(), new CommMessageStore()),
  );
  const markPaid = { run: () => Promise.resolve() } as unknown as MarkInvoicePaid;
  const balance = new ComputeInvoiceBalance(invoices, payments, markPaid);
  const now = new Date().toISOString();
  await (await getKv()).set(["user", "u-1"], {
    id: "u-1",
    phoneNumber: "+15125550000",
    name: "Test Contractor",
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  });
  await identities.upsert("u-1", {
    businessName: "Pisos Ortega LLC",
    commsLanguage: "es",
  });
  const customer = await customers.create("u-1", {
    name: "María López",
    email: "maria@acme.test",
  });
  return { flow, quotes, invoices, payments, balance, customer, sent };
}

type Rig = Awaited<ReturnType<typeof rig>>;

async function partPaid(r: Rig, quoteLinked: boolean) {
  let quoteId: string | undefined;
  if (quoteLinked) {
    const q = await r.quotes.create("u-1", {
      customerId: r.customer.id,
      summary: "Cambio de piso",
      lineItems: [{
        description: "Cambio de piso de cocina",
        quantity: 1,
        unit: "job",
        price: TOTAL,
      }],
      estimatedTotal: TOTAL,
    });
    quoteId = q.id;
  }
  const inv = await r.invoices.create("u-1", {
    ...(quoteId ? { quoteId } : { jobName: "Cambio de piso de cocina" }),
    customerId: r.customer.id,
    amount: TOTAL,
    status: "sent",
    issuedDate: "2026-11-10",
    dueDate: "2099-12-31",
  } as never);
  await r.payments.create("u-1", {
    invoiceId: inv.id,
    amount: PAID,
    method: "cash",
    receivedAt: "2026-11-15T00:00:00.000Z",
  });
  const b = await r.balance.run(inv.id, "u-1");
  assertEquals(b.balance, TOTAL - PAID, "setup: $690.75 left");
  assertEquals(b.status, "pending", "setup: a part payment stores status pending");
  return inv;
}

/** The hidden preheader span (the inbox preview line). */
function preheaderOf(html: string): string {
  const m = html.match(/<span style="display:none!important[^"]*">([^<]*)<\/span>/);
  assert(m, "the email has a preheader");
  return m[1];
}

/** The money card's big figure (the itemized card's `pw-amt-n`, or the
 *  basic invoice card's 28px figure). */
function moneyCardOf(html: string): string {
  const m = html.match(
    /(?:class="pw-amt-n"|font-size:28px;letter-spacing:-0\.02em;)[^>]*>\s*(\$[\d,]+\.\d\d)/,
  );
  assert(m, "the email has a money card with an amount");
  return m[1];
}

/** The Estado cell of the details table. */
function estadoOf(html: string): string {
  const label = t("es", "paperworkEmail.invoice.statusLabel");
  const at = html.indexOf(`>${label}<`);
  assert(at >= 0, `the email has an "${label}" row`);
  const m = html.slice(at).match(/<\/td><td[^>]*>([^<]*)<\/td>/);
  assert(m, "the Estado row has a value cell");
  return m[1].trim();
}

for (const quoteLinked of [false, true]) {
  const kind = quoteLinked ? "quote-linked (renderInvoiceHtml)" : "standalone (renderInvoiceBasicHtml)";

  Deno.test(`REQ-1028 (LOOP-007 q2-9) ${kind}: the es email of a part-paid invoice asks for the ${BALANCE} balance in the money card, not ${FULL}`, async () => {
    const r = await rig();
    try {
      const inv = await partPaid(r, quoteLinked);
      const out = await r.flow.run("u-1", { kind: "invoice", resourceId: inv.id, language: "es" });
      assert(out.ok, `send failed: ${JSON.stringify(out)}`);
      const html = r.sent[0].htmlBody;
      const card = moneyCardOf(html);
      assertEquals(card, BALANCE, `money card asks for ${card}, the balance is ${BALANCE}`);
    } finally {
      await resetKv();
    }
  });

  Deno.test(`REQ-1028 (LOOP-007 q2-9) ${kind}: the es preheader of a part-paid invoice names the ${BALANCE} balance, not ${FULL}`, async () => {
    const r = await rig();
    try {
      const inv = await partPaid(r, quoteLinked);
      const out = await r.flow.run("u-1", { kind: "invoice", resourceId: inv.id, language: "es" });
      assert(out.ok, `send failed: ${JSON.stringify(out)}`);
      const pre = preheaderOf(r.sent[0].htmlBody);
      assert(pre.includes(BALANCE), `preheader "${pre}" names ${BALANCE}`);
      assert(!pre.includes(FULL), `preheader "${pre}" asks for the full ${FULL}`);
    } finally {
      await resetKv();
    }
  });
}

Deno.test("REQ-1028 (LOOP-007 q2-9): the es email of a part-paid invoice never prints the English enum 'Pending'", async () => {
  const r = await rig();
  try {
    const inv = await partPaid(r, false);
    const out = await r.flow.run("u-1", { kind: "invoice", resourceId: inv.id, language: "es" });
    assert(out.ok, `send failed: ${JSON.stringify(out)}`);
    const html = r.sent[0].htmlBody;
    const estado = estadoOf(html);
    assert(estado.toLowerCase() !== "pending", `Estado reads "${estado}"`);
    assert(!/>\s*Pending\s*</.test(html), "a cell reads 'Pending' in the Spanish email");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1028 (LOOP-007 q2-20): the es email of a sent invoice reads 'Estado Enviada' like /i, never 'Enviado'", async () => {
  const r = await rig();
  try {
    const inv = await r.invoices.create("u-1", {
      jobName: "Cambio de piso de cocina",
      customerId: r.customer.id,
      amount: TOTAL,
      status: "sent",
      issuedDate: "2026-11-10",
      dueDate: "2099-12-31",
    } as never);
    const out = await r.flow.run("u-1", { kind: "invoice", resourceId: inv.id, language: "es" });
    assert(out.ok, `send failed: ${JSON.stringify(out)}`);
    assertEquals(
      estadoOf(r.sent[0].htmlBody),
      t("es", "public.doc.state.sent"),
      "the Estado cell matches /i's 'Enviada'",
    );
  } finally {
    await resetKv();
  }
});
