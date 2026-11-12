/**
 * REQ-233 (demo issue B2) over HTTP on the booted app — one $2,400 job was
 * billed $4,800. The customer signed the 50/50 quote on /q (the accept
 * endpoint bills INV-001 $1,200 sent + INV-002 $1,200 scheduled), then the
 * assistant's "Send as Invoice" swap POSTed /invoices { quoteId, amount:
 * 240000 } and the backend saved a third, full-amount invoice.
 *
 * POST /invoices with a quoteId is the real guard: an amount past what is
 * still unbilled on the agreement (quote total + approved change orders −
 * every non-void invoice on the quote) is a 409 `exceeds_agreement`, unless
 * the request says `override: true`.
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

const PORT = 9533;
const BASE = `http://localhost:${PORT}`;
const json = { "content-type": "application/json" };
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=";

async function login(phone = "+15125550233"): Promise<Record<string, string>> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  const auth = { ...json, "x-session-id": v.sessionId };
  await (await fetch(`${BASE}/me`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ name: "Rafa Castro" }),
  })).body?.cancel();
  return auth;
}

async function post(
  path: string,
  headers: Record<string, string>,
  body: unknown,
) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
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

async function signedFiftyFifty(auth: Record<string, string>) {
  const customer = await post("/customers", auth, {
    name: "Dana Whitfield",
    email: "dana@example.com",
  });
  const quote = await post("/quotes", auth, {
    summary: "Interior paint — 3 rooms",
    customerId: customer.body.id,
    lineItems: [{
      description: "Paint 3 rooms",
      quantity: 1,
      unit: "job",
      price: 240000,
    }],
    estimatedTotal: 240000,
    terms: [{
      stepId: "payment_terms",
      label: "Payment terms",
      value: "50 / 50",
    }],
    status: "sent",
  });
  const accept = await post(`/quotes/${quote.body.id}/accept`, json, {
    name: "Dana Whitfield",
    signature: SIGNATURE_PNG,
  });
  assertEquals(accept.status < 400, true, JSON.stringify(accept.body));
  return { quoteId: quote.body.id as string, customerId: customer.body.id };
}

async function dealBilled(auth: Record<string, string>, quoteId: string) {
  const all = await fetch(`${BASE}/invoices`, { headers: auth }).then((r) =>
    r.json()
  ) as Array<{ quoteId?: string; amount?: number; status?: string }>;
  const live = all.filter((i) =>
    i.quoteId === quoteId && i.status !== "void" && i.status !== "canceled"
  );
  return {
    count: live.length,
    cents: live.reduce((s, i) => s + (i.amount ?? 0), 0),
  };
}

Deno.test("REQ-233 B2: after signing a 50/50 $2,400 quote, POST /invoices for the full $2,400 is a 409 exceeds_agreement — the deal stays billed at $2,400", async () => {
  await withServer(async () => {
    const auth = await login();
    const { quoteId, customerId } = await signedFiftyFifty(auth);
    assertEquals(await dealBilled(auth, quoteId), { count: 2, cents: 240000 });

    // exactly what the assistant's "Send as Invoice" swap sends
    const third = await post("/invoices", auth, {
      customerId,
      quoteId,
      amount: 240000,
      dueDate: "2026-12-01",
      issuedDate: "2026-11-11",
      status: "sent",
    });
    assertEquals(third.status, 409);
    assertEquals(third.body.reason, "exceeds_agreement");
    assertEquals(third.body.remainingCents, 0);
    assertEquals(third.body.agreementTotalCents, 240000);
    assertEquals(await dealBilled(auth, quoteId), { count: 2, cents: 240000 });

    // a derived amount (no amount sent → the quote's total) is capped the same
    const derived = await post("/invoices", auth, { quoteId });
    assertEquals(derived.status, 409);
    assertEquals(derived.body.reason, "exceeds_agreement");
  });
});

Deno.test("REQ-233: invoice-first still works — an un-billed quote takes its full total, then a second full invoice is refused", async () => {
  await withServer(async () => {
    const auth = await login("+15125550234");
    const quote = await post("/quotes", auth, {
      summary: "Fence repair",
      lineItems: [{
        description: "Fence",
        quantity: 1,
        unit: "job",
        price: 50000,
      }],
      estimatedTotal: 50000,
    });
    assertEquals(typeof quote.body.id, "string", JSON.stringify(quote.body));
    const first = await post("/invoices", auth, {
      quoteId: quote.body.id,
      amount: 50000,
    });
    assertEquals(first.status, 200, JSON.stringify(first.body));
    const second = await post("/invoices", auth, {
      quoteId: quote.body.id,
      amount: 50000,
    });
    assertEquals(second.status, 409);
    assertEquals(second.body.reason, "exceeds_agreement");
  });
});

Deno.test("REQ-233: an explicit override still bills past the agreement (extra work the contractor chose to bill)", async () => {
  await withServer(async () => {
    const auth = await login("+15125550235");
    const { quoteId } = await signedFiftyFifty(auth);
    const extra = await post("/invoices", auth, {
      quoteId,
      amount: 30000,
      override: true,
    });
    assertEquals(extra.status, 200, JSON.stringify(extra.body));
    assertEquals(await dealBilled(auth, quoteId), { count: 3, cents: 270000 });
  });
});

Deno.test("REQ-233 + REQ-200: a retried create (same Idempotency-Key) still gets its invoice back, not a 409", async () => {
  await withServer(async () => {
    const auth = await login("+15125550236");
    const quote = await post("/quotes", auth, {
      summary: "Deck stain",
      lineItems: [{
        description: "Deck",
        quantity: 1,
        unit: "job",
        price: 80000,
      }],
      estimatedTotal: 80000,
    });
    const headers = { ...auth, "idempotency-key": "req-233-retry" };
    const a = await post("/invoices", headers, {
      quoteId: quote.body.id,
      amount: 80000,
    });
    const b = await post("/invoices", headers, {
      quoteId: quote.body.id,
      amount: 80000,
    });
    assertEquals([a.status, b.status], [200, 200]);
    assertEquals(a.body.id, b.body.id);
    assertEquals(a.body.override, undefined);
  });
});
