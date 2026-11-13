/**
 * REQ-679 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue M18: after an approved
 * change order the client's invoice showed three balances — "BALANCE DUE
 * $9,750.00", "AGREEMENT VALUE $16,300.00" and a schedule "BALANCE $8,150.00
 * On completion". getInvoicePublic, the invoice PDF and the invoice email
 * read quote.estimatedTotal and never added the approved change orders.
 *
 * The demo's job: Q-001 $16,300 at 50/50 — INV-001 deposit $8,150 (paid),
 * INV-002 balance $8,150 (sent), CO-001 +$1,600 on INV-002, approved by the
 * customer → INV-002 $9,750, agreement $17,900.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;

async function login(phone = "+15125557461"): Promise<string> {
  await (await fetch(`${base()}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base()}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function boot() {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  return server;
}

/** the demo's job, the change order approved by the customer on /co */
async function seedApprovedJob(userId: string) {
  const customer = await new CustomerStore().create(userId, {
    name: "Dana Whitfield",
    email: "dana@example.test",
  });
  const q = await new QuoteStore().create(userId, {
    summary: "Deck rebuild",
    jobName: "Deck rebuild",
    customerId: customer.id,
    lineItems: [{
      description: "Deck rebuild",
      quantity: 1,
      unit: "job",
      price: 1_630_000,
    }],
    estimatedTotal: 1_630_000,
    terms: [{
      stepId: "payment_terms",
      label: "Payment terms",
      value: "50 / 50",
    }],
  } as never);
  await new QuoteStore().update(q.id, userId, { status: "accepted" });
  const deposit = await new InvoiceStore().create(userId, {
    quoteId: q.id,
    customerId: customer.id,
    amount: 815_000,
    status: "paid",
    paidAt: "2026-11-10T12:00:00Z",
    installmentIndex: 1,
    installmentTotal: 2,
    jobName: "Deck rebuild",
  } as never);
  const balance = await new InvoiceStore().create(userId, {
    quoteId: q.id,
    customerId: customer.id,
    amount: 815_000,
    status: "sent",
    installmentIndex: 2,
    installmentTotal: 2,
    jobName: "Deck rebuild",
  } as never);
  const co = await new ChangeOrderStore().create(userId, balance.id, {
    description: "Composite railing upgrade",
    deltaAmountCents: 160_000,
    quoteId: q.id,
    customerId: customer.id,
    originalAmountCents: 815_000,
  });
  const r = await fetch(`${base()}/change-orders/${co.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Dana Whitfield" }),
  });
  assertEquals(r.status, 200, await r.text());
  return { quoteId: q.id, depositId: deposit.id, balanceId: balance.id };
}

/** Every string pdf-lib drew (Flate-compressed hex-string Tj operators). */
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

Deno.test("REQ-679 M18: after an approved +$1,600 change order, /i's agreement total is $17,900 (quote $16,300 + the approved order), next to the $9,750 balance due", async () => {
  const server = await boot();
  try {
    const sid = await login();
    const owner = (await new SessionStore().get(sid))!;
    const { balanceId } = await seedApprovedJob(owner.userId);
    const body = await fetch(`${base()}/invoices/${balanceId}/public`).then((
      r,
    ) => r.json());
    assertEquals(body.amount, 975_000, "the balance invoice after the CO");
    assertEquals(
      body.agreementTotal,
      1_790_000,
      "the agreement value includes the approved change order",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("REQ-679 M18: the invoice PDF's agreement value is $17,900 and its schedule the real installments ($8,150 deposit, $9,750 balance)", async () => {
  const server = await boot();
  try {
    const sid = await login();
    const owner = (await new SessionStore().get(sid))!;
    const { balanceId } = await seedApprovedJob(owner.userId);
    const res = await fetch(`${base()}/invoices/${balanceId}/pdf`);
    assertEquals(res.status, 200);
    const text = await drawnText(new Uint8Array(await res.arrayBuffer()));
    // the quote's own line still reads $16,300; the agreement is $17,900
    assertStringIncludes(
      text,
      "AGREEMENT VALUE\nall in, no surprises\n$17,900.00",
    );
    assertStringIncludes(text, "DEPOSIT\n$8,150.00");
    assertStringIncludes(text, "BALANCE\n$9,750.00");
    assert(
      !text.includes("$8,950.00"),
      "the schedule is the real installments, not a re-split of $17,900",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("REQ-679 M18: the invoice email's agreement value is $17,900", async () => {
  const server = await boot();
  try {
    const sid = await login();
    const owner = (await new SessionStore().get(sid))!;
    await new UserStore().update(owner.userId, { name: "Test Contractor" })
      .catch(() => {});
    const { balanceId } = await seedApprovedJob(owner.userId);
    const email = new EmailService();
    const sent: SendEmailInput[] = [];
    email.send = (input: SendEmailInput) => {
      sent.push(input);
      return Promise.resolve({ ok: true, reason: "test_capture" });
    };
    const flow = new SendPaperworkEmail(
      new QuoteStore(),
      new InvoiceStore(),
      new CustomerStore(),
      new UserStore(),
      new BusinessIdentityStore(),
      email,
      new LogPaperworkMessage(
        new CommConversationStore(),
        new CommMessageStore(),
      ),
    );
    const r = await flow.run(owner.userId, {
      kind: "invoice",
      resourceId: balanceId,
    });
    assertEquals(r.ok, true, JSON.stringify(r));
    const html = sent[0].htmlBody ?? "";
    assertStringIncludes(html, "$17,900.00");
  } finally {
    await server.stop();
    await resetKv();
  }
});
