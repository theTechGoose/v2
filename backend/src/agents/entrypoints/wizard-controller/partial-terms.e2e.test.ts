import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

/**
 * REQ-240 (demo M29) on the booted app — the demo's exact path: a quote is
 * out, the contractor answers the customer step (Maria) and the start date
 * ("Next week"), then leaves before finishing the wizard. The customer opens
 * the link and signs. The agreement must name Maria and the start date, and
 * the invoice the signature creates must bill Maria and not be due the day
 * it was signed.
 */
@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9474;
const BASE = `http://localhost:${PORT}`;
const J = { "content-type": "application/json" };

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

async function login(phone = "+15125551234"): Promise<string> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function post(path: string, body: unknown, sid?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: sid ? { ...J, "x-session-id": sid } : J,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => undefined);
  assert(res.ok, `${path} answered ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

Deno.test("REQ-240 (M29) e2e: a half-finished terms wizard still puts the customer and start date on the agreement, and the signed invoice bills that customer, not due the same day", async () => {
  await withServer(async () => {
    const sid = await login();
    const quote = await post("/quotes", {
      summary: "Bathroom tile",
      lineItems: [{
        description: "Tile",
        quantity: 1,
        unit: "ea",
        price: 480_000,
      }],
      estimatedTotal: 480_000,
      status: "sent",
    }, sid);
    const conv = await post(
      "/agents/conversations",
      { quoteId: quote.id },
      sid,
    );
    const convId = conv.id ?? conv.conversation?.id;
    await post(`/agents/conversations/${convId}/transition-to-terms`, {}, sid);
    await post("/agents/wizard/answer", {
      conversationId: convId,
      stepId: "customer",
      optionId: "create_new",
      customer: { create: { name: "Maria Lopez" } },
    }, sid);
    await post("/agents/wizard/answer", {
      conversationId: convId,
      stepId: "start_date",
      optionId: "next_week",
    }, sid);
    // …and the contractor leaves: wraps / payment / warranty never answered.

    const pub = await fetch(`${BASE}/quotes/${quote.id}/public`).then((r) =>
      r.json()
    );
    assertEquals(
      pub.customer?.name,
      "Maria Lopez",
      "the agreement names the customer (was 'PARA —')",
    );
    const start = (pub.terms ?? []).find((t: { stepId: string }) =>
      t.stepId === "start_date"
    );
    assert(
      start?.value,
      "the agreement carries the start date (was 'INICIO Por agendar')",
    );

    await post(`/quotes/${quote.id}/accept`, {
      name: "Maria Lopez",
      signature: "data:image/png;base64,...",
    });

    const invoices = await fetch(`${BASE}/invoices`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    const inv = invoices.find((i: { quoteId?: string }) =>
      i.quoteId === quote.id
    );
    assert(inv, "the signature bills");
    const ipub = await fetch(`${BASE}/invoices/${inv.id}/public`).then((r) =>
      r.json()
    );
    assertEquals(
      ipub.customer?.name,
      "Maria Lopez",
      "the invoice bills the customer (was 'FACTURAR A —')",
    );
    const today = new Date().toISOString().slice(0, 10);
    assert(
      inv.dueDate > today,
      `no payment terms were agreed — due ${inv.dueDate}, not the day of signing`,
    );
  });
});
