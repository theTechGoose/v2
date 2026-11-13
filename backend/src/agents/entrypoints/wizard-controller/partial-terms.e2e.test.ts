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
 * ("Next week"), then leaves before finishing the wizard. The agreement must
 * already name Maria and the start date.
 *
 * REQ-460 (demo-loop cycle 3, M16 + M15) amends the rest: the half-finished
 * agreement is NOT signable (409 `not_issued`, nothing billed) — the demo's
 * mid-wizard signature billed the whole total as one invoice. Once the
 * contractor finishes the terms and sends it, the signature's invoice bills
 * Maria and is not due the day it was signed.
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

async function send(
  method: string,
  path: string,
  body: unknown,
  sid?: string,
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: sid ? { ...J, "x-session-id": sid } : J,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => undefined);
  return { status: res.status, ok: res.ok, json };
}

async function post(path: string, body: unknown, sid?: string) {
  const { status, ok, json } = await send("POST", path, body, sid);
  assert(ok, `${path} answered ${status}: ${JSON.stringify(json)}`);
  return json;
}

Deno.test("REQ-240 (M29) + REQ-460 (c3 M16) e2e: a half-finished terms wizard puts the customer and start date on the agreement but cannot be signed; finished and sent, the signed invoice bills that customer, not due the same day", async () => {
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

    // REQ-460: the half-finished agreement is not signable, nothing billed
    const early = await send("POST", `/quotes/${quote.id}/accept`, {
      name: "Maria Lopez",
      signature: "data:image/png;base64,...",
    });
    assertEquals(
      { status: early.status, reason: early.json?.reason },
      { status: 409, reason: "not_issued" },
      "a quote nobody sent, its wizard half done, is not signed",
    );
    const none = await fetch(`${BASE}/invoices`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(
      none.filter((i: { quoteId?: string }) => i.quoteId === quote.id),
      [],
      "nothing billed",
    );

    // …the contractor finishes the terms and sends it
    for (
      const [stepId, optionId] of [
        ["wraps", "2_3_days"],
        ["payment_terms", "net_15"],
        ["warranty", "none"],
      ]
    ) {
      await post("/agents/wizard/answer", {
        conversationId: convId,
        stepId,
        optionId,
      }, sid);
    }
    const sent = await send(
      "PUT",
      `/quotes/${quote.id}`,
      { status: "sent" },
      sid,
    );
    assert(sent.ok, `PUT status sent answered ${sent.status}`);

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
      `net 15 — due ${inv.dueDate}, not the day of signing`,
    );
  });
});
