/**
 * REQ-926 — Raphael: "lets remove the in transit, add to the payment a
 * 'chargeback' button … add a default fee in the settings and a modal when
 * the chargeback is clicked to add a fee with the default populated."
 * POST /payments/:id/chargeback keeps the payment (stamped), reopens the
 * same invoice, adds the fee as a line; /undo takes it back.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AnalyticsModule] })
class TestApp {}

const PORT = 9926;
const BASE = `http://localhost:${PORT}`;

// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any };
async function call(
  method: string,
  path: string,
  body?: unknown,
  sid?: string,
): Promise<Res> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(sid ? { "x-session-id": sid } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch { /* raw */ }
  return { status: r.status, body: parsed };
}

async function login(phone: string): Promise<string> {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const sid = v.body.sessionId as string;
  await call("PUT", "/me", { name: "Chargeback Owner", language: "en" }, sid);
  return sid;
}

async function withServer(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
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

Deno.test("REQ-926 chargeback: the payment is kept and stamped, the same invoice reopens owing the amount + the fee line, totals skip it, twice is 409, another owner 404; undo restores it all", async () => {
  await withServer(async () => {
    const sid = await login("+15125559261");
    const inv = (await call("POST", "/invoices", {
      status: "sent",
      jobName: "Gutter clean",
      billTo: { name: "Rosa Diaz" },
      lineItems: [{
        description: "Gutter clean",
        quantity: 1,
        unit: "job",
        price: 25000,
      }],
      subtotalCents: 25000,
      amount: 25000,
    }, sid)).body;
    assert(inv.id, JSON.stringify(inv));
    const pay = (await call("POST", "/payments", {
      invoiceId: inv.id,
      amount: 25000,
      method: "check",
      receivedAt: new Date().toISOString(),
    }, sid)).body;
    assert(pay.id, JSON.stringify(pay));
    assertEquals(
      (await call("GET", `/invoices/${inv.id}`, undefined, sid)).body.status,
      "paid",
    );

    const cb = await call("POST", `/payments/${pay.id}/chargeback`, {
      feeCents: 3500,
      reason: "Check bounced",
    }, sid);
    assertEquals(cb.status, 200, JSON.stringify(cb.body));
    assert(cb.body.reversedAt, "stamped");
    assertEquals(
      [cb.body.reversedFeeCents, cb.body.reversedReason],
      [3500, "Check bounced"],
    );

    const reopened = (await call("GET", `/invoices/${inv.id}`, undefined, sid))
      .body;
    assert(reopened.status !== "paid", `reopened: ${reopened.status}`);
    assertEquals(reopened.amount, 28500, "amount + the fee");
    assertEquals(reopened.subtotalCents, 28500);
    assertEquals(
      reopened.paidCents ?? 0,
      0,
      "the reversed payment pays nothing",
    );
    const fee = reopened.lineItems.at(-1);
    assertEquals(
      [fee.description, fee.price, fee.chargebackFor],
      ["Chargeback fee", 3500, pay.id],
    );
    // kept, not deleted — and listed with its stamp
    const listed = (await call("GET", "/payments", undefined, sid)).body;
    assertEquals(listed.length, 1);
    assert(listed[0].reversedAt);
    // the invoice's own payments (what its panel sums) skip it
    assertEquals(
      (await call("GET", `/payments?invoiceId=${inv.id}`, undefined, sid))
        .body,
      [],
    );
    const again = await call("POST", `/payments/${pay.id}/chargeback`, {
      feeCents: 0,
    }, sid);
    assertEquals([again.status, again.body.reason], [409, "already_reversed"]);

    const other = await login("+15125559262");
    const foreign = await call(
      "POST",
      `/payments/${pay.id}/chargeback`,
      {},
      other,
    );
    assertEquals(foreign.status, 404);

    const undo = await call(
      "POST",
      `/payments/${pay.id}/chargeback/undo`,
      {},
      sid,
    );
    assertEquals(undo.status, 200, JSON.stringify(undo.body));
    assertEquals(undo.body.reversedAt, undefined);
    const back = (await call("GET", `/invoices/${inv.id}`, undefined, sid))
      .body;
    assertEquals([back.status, back.amount, back.lineItems.length], [
      "paid",
      25000,
      1,
    ]);
    const notReversed = await call(
      "POST",
      `/payments/${pay.id}/chargeback/undo`,
      {},
      sid,
    );
    assertEquals([notReversed.status, notReversed.body.reason], [
      409,
      "not_reversed",
    ]);
  });
});

Deno.test("REQ-926 chargeback: no fee adds no line; the Settings default (chargebackFeeCents) round-trips on the business identity and refuses a negative", async () => {
  await withServer(async () => {
    const sid = await login("+15125559263");
    const put = await call("PUT", "/profile/identity", {
      chargebackFeeCents: 3500,
    }, sid);
    assert(put.status < 300, JSON.stringify(put.body));
    const got = (await call("GET", "/profile/identity", undefined, sid)).body;
    assertEquals(got.chargebackFeeCents, 3500);
    const bad = await call("PUT", "/profile/identity", {
      chargebackFeeCents: -1,
    }, sid);
    assert(bad.status >= 400, `refused: ${bad.status}`);

    const inv = (await call("POST", "/invoices", {
      status: "sent",
      jobName: "Mulch",
      billTo: { name: "Ana" },
      amount: 9000,
    }, sid)).body;
    const pay = (await call("POST", "/payments", {
      invoiceId: inv.id,
      amount: 9000,
      method: "zelle",
      receivedAt: new Date().toISOString(),
    }, sid)).body;
    const cb = await call("POST", `/payments/${pay.id}/chargeback`, {
      feeCents: 0,
    }, sid);
    assertEquals(cb.status, 200, JSON.stringify(cb.body));
    const reopened = (await call("GET", `/invoices/${inv.id}`, undefined, sid))
      .body;
    assertEquals(reopened.amount, 9000);
    assert(reopened.status !== "paid");
    assertEquals((reopened.lineItems ?? []).length, 0, "no fee, no line");
    const undone = await call(
      "POST",
      `/payments/${pay.id}/chargeback/undo`,
      {},
      sid,
    );
    assertEquals(undone.status, 200);
    const badFee = await call("POST", `/payments/${pay.id}/chargeback`, {
      feeCents: -5,
    }, sid);
    assertEquals([badFee.status, badFee.body.reason], [400, "invalid_fee"]);
  });
});
