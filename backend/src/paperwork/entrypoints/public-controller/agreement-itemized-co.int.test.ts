/**
 * REQ-950 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the test,
 * then one to fix it and make it green." LOOP-007 cycle 1, issue q1-24
 * [minor/BUG_CONTRADICTION]: INV-001 shows "AGREEMENT VALUE $24,500.00"
 * under an itemized table that adds up to $23,250 — the approved change
 * order (CO-001 Heated floor, +$1,250, attached to INV-002) is in the
 * agreement total (REQ-679) but in none of the itemized rows.
 *
 * The tester's job: Q-001 $23,250 (Tile demo & prep $9,800 + Tile install
 * $13,450) — INV-001 deposit $4,650, INV-002 balance $18,600; CO-001 +$1,250
 * on INV-002, approved by the customer on /co → agreement $24,500.
 *
 * Contract for the fix (either shape passes): the approved change orders are
 * itemized in GET /invoices/:id/public, either appended to
 * jobDetails.lineItems ({description, quantity, price}) or as
 * `agreementChangeOrders: [{number, description, deltaAmountCents}]`.
 * Either way, the itemized rows on every invoice of the job add up to
 * agreementTotal; the PDF and the email draw the change-order row before the
 * AGREEMENT VALUE figure.
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

async function login(phone = "+15125559524"): Promise<string> {
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

/** the q1-24 job: CO-001 sits on INV-002 and is approved on /co */
async function seedTileJob(userId: string) {
  const customer = await new CustomerStore().create(userId, {
    name: "Priya Raman",
    email: "priya@example.test",
  });
  const q = await new QuoteStore().create(userId, {
    summary: "Bathroom tile",
    jobName: "Bathroom tile",
    customerId: customer.id,
    lineItems: [
      {
        description: "Tile demo & prep",
        quantity: 1,
        unit: "job",
        price: 980_000,
      },
      {
        description: "Tile install",
        quantity: 1,
        unit: "job",
        price: 1_345_000,
      },
    ],
    estimatedTotal: 2_325_000,
    terms: [{
      stepId: "payment_terms",
      label: "Payment terms",
      value: "20% deposit, balance on completion",
    }],
  } as never);
  await new QuoteStore().update(q.id, userId, { status: "accepted" });
  const deposit = await new InvoiceStore().create(userId, {
    quoteId: q.id,
    customerId: customer.id,
    amount: 465_000,
    status: "sent",
    installmentIndex: 1,
    installmentTotal: 2,
    jobName: "Bathroom tile",
  } as never);
  const balance = await new InvoiceStore().create(userId, {
    quoteId: q.id,
    customerId: customer.id,
    amount: 1_860_000,
    status: "sent",
    installmentIndex: 2,
    installmentTotal: 2,
    jobName: "Bathroom tile",
  } as never);
  const co = await new ChangeOrderStore().create(userId, balance.id, {
    description: "Heated floor added under the tile",
    deltaAmountCents: 125_000,
    quoteId: q.id,
    customerId: customer.id,
    originalAmountCents: 1_860_000,
  });
  const r = await fetch(`${base()}/change-orders/${co.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Priya Raman" }),
  });
  assertEquals(r.status, 200, await r.text());
  return { quoteId: q.id, depositId: deposit.id, balanceId: balance.id };
}

type Row = { description: string; cents: number };

/** every itemized row the public invoice carries for the agreement */
function itemizedRows(body: {
  jobDetails?: {
    lineItems?: {
      description?: string;
      quantity?: number;
      price?: number;
    }[];
  };
  agreementChangeOrders?: {
    number?: string;
    description?: string;
    status?: string;
    deltaAmountCents?: number;
  }[];
}): Row[] {
  const lines = (body.jobDetails?.lineItems ?? []).map((li) => ({
    description: li.description ?? "",
    cents: (li.price ?? 0) * (li.quantity ?? 1),
  }));
  const cos = (body.agreementChangeOrders ?? [])
    .filter((c) => !c.status || c.status === "approved")
    .map((c) => ({
      description: `${c.number ?? ""} ${c.description ?? ""}`.trim(),
      cents: c.deltaAmountCents ?? 0,
    }));
  return [...lines, ...cos];
}

Deno.test("REQ-950 q1-24: on the deposit invoice (INV-001) the itemized rows add up to the $24,500 agreement value — the approved CO-001 Heated floor row is listed", async () => {
  const server = await boot();
  try {
    const sid = await login();
    const owner = (await new SessionStore().get(sid))!;
    const { depositId } = await seedTileJob(owner.userId);
    const body = await fetch(`${base()}/invoices/${depositId}/public`).then((
      r,
    ) => r.json());
    assertEquals(body.amount, 465_000, "INV-001 still bills its $4,650");
    assertEquals(
      body.agreementTotal,
      2_450_000,
      "the agreement value includes the approved change order (REQ-679)",
    );
    const rows = itemizedRows(body);
    assert(
      rows.some((r) => /heated floor/i.test(r.description)),
      `the approved change order is itemized on INV-001 (rows: ${
        JSON.stringify(rows)
      })`,
    );
    assertEquals(
      rows.reduce((s, r) => s + r.cents, 0),
      body.agreementTotal,
      "the itemized rows add up to the agreement value printed under them",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("REQ-950 q1-24: on the balance invoice (INV-002) the itemized rows add up to the $24,500 agreement value too", async () => {
  const server = await boot();
  try {
    const sid = await login();
    const owner = (await new SessionStore().get(sid))!;
    const { balanceId } = await seedTileJob(owner.userId);
    const body = await fetch(`${base()}/invoices/${balanceId}/public`).then((
      r,
    ) => r.json());
    assertEquals(body.amount, 1_985_000, "INV-002 after the CO");
    assertEquals(body.agreementTotal, 2_450_000);
    assertEquals(
      itemizedRows(body).reduce((s, r) => s + r.cents, 0),
      body.agreementTotal,
      "the itemized rows add up to the agreement value",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("REQ-950 q1-24: the deposit invoice's PDF draws the CO-001 Heated floor row ($1,250.00) above AGREEMENT VALUE $24,500.00", async () => {
  const server = await boot();
  try {
    const sid = await login();
    const owner = (await new SessionStore().get(sid))!;
    const { depositId } = await seedTileJob(owner.userId);
    const res = await fetch(`${base()}/invoices/${depositId}/pdf`);
    assertEquals(res.status, 200);
    const text = await drawnText(new Uint8Array(await res.arrayBuffer()));
    assertStringIncludes(
      text,
      "AGREEMENT VALUE\nall in, no surprises\n$24,500.00",
    );
    const total = text.indexOf("AGREEMENT VALUE");
    const co = text.search(/heated floor/i);
    assert(
      co >= 0 && co < total,
      `the Heated floor row is drawn before the agreement value (drawn text:\n${
        text.slice(0, total + 60)
      })`,
    );
    assertStringIncludes(
      text.slice(co, total),
      "$1,250.00",
      "the change order's amount on its row",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("REQ-950 q1-24: the deposit invoice's email itemizes the CO-001 Heated floor row ($1,250.00) with the $24,500.00 agreement value", async () => {
  const server = await boot();
  try {
    const sid = await login();
    const owner = (await new SessionStore().get(sid))!;
    await new UserStore().update(owner.userId, { name: "Test Contractor" })
      .catch(() => {});
    const { depositId } = await seedTileJob(owner.userId);
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
      resourceId: depositId,
    });
    assertEquals(r.ok, true, JSON.stringify(r));
    const html = sent[0].htmlBody ?? "";
    assertStringIncludes(html, "$24,500.00", "the agreement value");
    const co = html.search(/heated floor/i);
    assert(co >= 0, "the approved change order is itemized in the email");
    assertStringIncludes(
      html.slice(co, co + 2000),
      "$1,250.00",
      "the change order's amount on its row",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});

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
