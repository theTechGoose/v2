/**
 * REQ-493 (demo-loop cycle 3, issue m7) — the owner's open pages follow what
 * the client did. They have no push channel; the one thing every owner page
 * polls is the topbar's notifications feed, and the front-end's change feed
 * (`front-end/lib/change-feed.ts`) reads each refresh of it as the documents
 * that moved. This drives the real app over HTTP — the customer signs on /q,
 * claims the deposit on /i, the owner confirms it — and reads
 * `GET /notifications` exactly as the page does: through `changesBetween`,
 * from the page's first list on. Each step must name the document the owner's
 * pages show (the quote; the invoice), or no page re-reads it.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { changesBetween } from "../../../../../front-end/lib/change-feed.ts";

// AgentsModule imports Users + Paperwork + Communication: the production
// wiring that carries a public accept through the EventBus to /notifications.
@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;
const JSON_HEADERS = { "content-type": "application/json" };

async function login(phone = "+15125557493"): Promise<string> {
  await (await fetch(`${base()}/auth/send-otp`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base()}/auth/verify-otp`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  const r = await fetch(`${base()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json)}`);
  }
  return json;
}

Deno.test("REQ-493 m7: the customer's signature, their payment claim and the owner's confirm each reach the owner's change feed — GET /notifications read through changesBetween names the quote, then the invoice", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    // the owner's page starts here; its first list is the topbar's first tick
    const since = Date.now();
    const sid = await login();
    const auth = { ...JSON_HEADERS, "x-session-id": sid };
    await call("PUT", "/me", auth, { language: "en", name: "Rosa" });
    const feed = () => call("GET", "/notifications?limit=10", auth);

    let list = await feed();
    assertEquals(
      changesBetween(null, list, since),
      [],
      "nothing has happened yet",
    );

    const customer = await call("POST", "/customers", auth, {
      name: "Maria Lopez",
      email: "maria@blackhole.postmarkapp.com",
    });
    const quote = await call("POST", "/quotes", auth, {
      customerId: customer.id,
      summary: "Cedar fence",
      jobName: "Cedar fence",
      lineItems: [{
        description: "Cedar fence",
        quantity: 1,
        unit: "job",
        price: 45000,
      }],
      estimatedTotal: 45000,
      terms: [{ stepId: "payment_terms", label: "Payment", value: "Due Now" }],
      status: "sent",
    });
    // REQ-460 (merged on demo-fixes): POST /quotes makes a draft; the
    // customer signs a SENT quote.
    await call("PUT", `/quotes/${quote.id}`, auth, { status: "sent" });

    // the customer signs on /q (no session)
    const accepted = await call(
      "POST",
      `/quotes/${quote.id}/accept`,
      JSON_HEADERS,
      { name: "Maria Lopez", signature: "data:image/png;base64,iVBORw0KGgo=" },
    );
    assertEquals(accepted.ok, true);
    let next = await feed();
    const signed = changesBetween(list, next, since);
    assert(
      signed.some((c) =>
        c.entityType === "quote" && c.entityId === quote.id &&
        c.type === "quote_accepted"
      ),
      `the signature names the quote: ${JSON.stringify(signed)}`,
    );
    list = next;

    // accept bills: the deposit invoice the owner's /invoices lists
    const invoices = await call("GET", "/invoices", auth) as {
      id: string;
      quoteId?: string;
      status?: string;
    }[];
    const deposit = invoices.find((i) => i.quoteId === quote.id);
    assert(
      deposit,
      `the signature billed an invoice: ${JSON.stringify(invoices)}`,
    );

    // the customer says they paid by Zelle on /i (no session)
    const claim = await call(
      "POST",
      `/invoices/${deposit.id}/claim-payment`,
      JSON_HEADERS,
      { method: "zelle" },
    );
    assertEquals(claim.ok, true);
    next = await feed();
    const claimed = changesBetween(list, next, since);
    assert(
      claimed.some((c) =>
        c.entityType === "invoice" && c.entityId === deposit.id &&
        c.type === "invoice_claimed"
      ),
      `the claim names the invoice: ${JSON.stringify(claimed)}`,
    );
    assertEquals(
      claimed.some((c) => c.entityType === "quote"),
      false,
      "the signature is not announced twice",
    );
    list = next;

    // the owner confirms it from another tab
    const confirmed = await call(
      "POST",
      `/invoices/${deposit.id}/confirm-payment`,
      auth,
    );
    assertEquals(confirmed.ok, true);
    next = await feed();
    const paid = changesBetween(list, next, since);
    assert(
      paid.some((c) =>
        c.entityType === "invoice" && c.entityId === deposit.id &&
        c.type === "invoice_paid"
      ),
      `the confirmed payment names the invoice: ${JSON.stringify(paid)}`,
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
