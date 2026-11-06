/**
 * REQ-210 — work orders (the A2Z customization): a numbered WO- document
 * under the client, linked to a customer / quote / invoice, contractor-side
 * only, revisable with history, listed in the quote's ledger.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule] })
class TestApp {}

const PORT = 9473;
const BASE = `http://localhost:${PORT}`;
async function drain(res: Response) {
  await res.body?.cancel();
}
async function login(phone = "+15125550301"): Promise<string> {
  await drain(
    await fetch(`${BASE}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
    }),
  );
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}
function auth(sid: string) {
  return { "content-type": "application/json", "x-session-id": sid };
}
async function withServer(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn();
  } finally {
    await server.stop();
    await resetKv();
  }
}
const req = (sid: string, method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: auth(sid),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

Deno.test("REQ-210: work orders are numbered WO-001… per account, linked to customer/quote/invoice, owner-gated, and the quote ledger lists them", async () => {
  await withServer(async () => {
    const sid = await login();
    const other = await login("+15125550302");
    const customer = await req(sid, "POST", "/customers", {
      name: "A2Z Site",
      address: "1 Main St",
    }).then((r) => r.json());
    const quote = await req(sid, "POST", "/quotes", {
      customerId: customer.id,
      summary: "Rooftop unit",
      lineItems: [{
        description: "RTU",
        quantity: 1,
        unit: "job",
        price: 50000,
      }],
      estimatedTotal: 50000,
    }).then((r) => r.json());
    const invoice = await req(sid, "POST", "/invoices", {
      customerId: customer.id,
      quoteId: quote.id,
      amount: 20000,
    })
      .then((r) => r.json());

    const created = await req(sid, "POST", "/work-orders", {
      customerId: customer.id,
      quoteId: quote.id,
      invoiceId: invoice.id,
      description: "Replace rooftop unit",
      serviceAddress: "1 Main St",
      scheduledFor: "2026-11-10",
      assignee: "Crew B",
      requestId: "wo-create-1",
    });
    assertEquals(created.status, 200);
    const wo = await created.json();
    assertEquals(wo.number, "WO-001");
    assertEquals(wo.version, 1);
    assertEquals(wo.status, "open");
    assertEquals(wo.customerSnapshot?.name, "A2Z Site");
    // a retry with the same requestId returns the same document (REQ-200)
    const again = await req(sid, "POST", "/work-orders", {
      customerId: customer.id,
      description: "dup",
      requestId: "wo-create-1",
    })
      .then((r) => r.json());
    assertEquals(again.id, wo.id);
    const second = await req(sid, "POST", "/work-orders", {
      customerId: customer.id,
      description: "Second",
    }).then((r) => r.json());
    assertEquals(second.number, "WO-002");

    // the other account cannot see it; its own numbering starts fresh
    assertEquals(
      (await req(other, "GET", `/work-orders/${wo.id}`)).status,
      403,
    );
    const theirs = await req(other, "POST", "/work-orders", {
      description: "theirs",
    }).then((r) => r.json());
    assertEquals(theirs.number, "WO-001");

    // the detail carries clickable links to what it belongs to
    const detail = await req(sid, "GET", `/work-orders/${wo.id}`).then((r) =>
      r.json()
    );
    assertEquals(detail.links.quote, {
      id: quote.id,
      number: quote.number,
      url: `/q/${quote.id}`,
    });
    assertEquals(detail.links.invoice, {
      id: invoice.id,
      number: invoice.number,
      url: `/i/${invoice.id}`,
    });
    assertEquals(detail.links.customer.id, customer.id);

    // list: by account, filterable by customer / quote / invoice
    const list = await req(sid, "GET", "/work-orders").then((r) => r.json());
    assertEquals(list.map((w: { number: string }) => w.number).sort(), [
      "WO-001",
      "WO-002",
    ]);
    const byQuote = await req(sid, "GET", `/work-orders?quoteId=${quote.id}`)
      .then((r) => r.json());
    assertEquals(byQuote.map((w: { number: string }) => w.number), ["WO-001"]);

    // an edit is a new version; the old one is filed with who/when; the number and id stay
    const edited = await req(sid, "PUT", `/work-orders/${wo.id}`, {
      status: "in_progress",
      assignee: "Crew C",
    }).then((r) => r.json());
    assertEquals(edited.id, wo.id);
    assertEquals(edited.number, "WO-001");
    assertEquals(edited.version, 2);
    assertEquals(edited.status, "in_progress");
    assertEquals(edited.assignee, "Crew C");
    const versions = await req(sid, "GET", `/work-orders/${wo.id}/versions`)
      .then((r) => r.json());
    assertEquals(versions.map((v: { version: number }) => v.version), [1, 2]);
    assertEquals(versions[0].content.assignee, "Crew B");
    assertEquals(typeof versions[0].publishedAt, "string");
    assertEquals(versions[1].current, true);
    // a bad status is refused
    assertEquals(
      (await req(sid, "PUT", `/work-orders/${wo.id}`, { status: "flying" }))
        .status,
      400,
    );

    // the quote ledger lists its work orders
    const ledger = await req(sid, "GET", `/quotes/${quote.id}/ledger`).then((
      r,
    ) => r.json());
    assertEquals(
      ledger.workOrders.map((
        w: { number: string; status: string; url: string },
      ) => [w.number, w.status, w.url]),
      [
        ["WO-001", "in_progress", `/wo/${wo.id}`],
      ],
    );

    // delete removes it from the list; its number is never reissued
    assertEquals(
      (await req(sid, "DELETE", `/work-orders/${second.id}`)).status,
      200,
    );
    const third = await req(sid, "POST", "/work-orders", {
      description: "Third",
    }).then((r) => r.json());
    assertEquals(third.number, "WO-003");
    const after = await req(sid, "GET", "/work-orders").then((r) => r.json());
    assertEquals(after.map((w: { number: string }) => w.number).sort(), [
      "WO-001",
      "WO-003",
    ]);
  });
});
