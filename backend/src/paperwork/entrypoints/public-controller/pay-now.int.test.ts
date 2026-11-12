/**
 * REQ-251 — demo issue quote-invoice-money-m13: once a quote is signed, the
 * public payload of /quotes/:id/public carries the invoice the accept just
 * billed, and payNowTarget() (the function the /q page's Pay now button reads)
 * points at THAT invoice's public page with its full balance. Unsigned: no
 * target.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { payNowTarget } from "#documents/linked-view.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);

async function login(phone = "+15125557251"): Promise<string> {
  await (await fetch(`http://localhost:${PORT}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${PORT}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("REQ-251: a signed quote's public payload yields a Pay now target — the invoice the accept billed, its full balance; unsigned yields none", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const q = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({
        summary: "Bathroom remodel",
        lineItems: [],
        status: "sent",
        estimatedTotal: 4_800_00,
        terms: [{ stepId: "payment_terms", value: "Due Now" }],
      }),
    }).then((r) => r.json());
    // REQ-460: the customer signs a SENT quote — POST /quotes makes a draft.
    await (await fetch(`http://localhost:${PORT}/quotes/${q.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ status: "sent" }),
    })).body?.cancel();

    const before = await fetch(
      `http://localhost:${PORT}/quotes/${q.id}/public`,
    ).then((r) => r.json());
    assertEquals(payNowTarget(before), undefined, "unsigned: no Pay button");

    const out = await fetch(`http://localhost:${PORT}/quotes/${q.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ana Pérez" }),
    }).then((r) => r.json());
    assertEquals(out.ok, true);

    const invoices = await fetch(`http://localhost:${PORT}/invoices`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    const billed = invoices.filter((i: { quoteId?: string }) =>
      i.quoteId === q.id
    );
    assertEquals(billed.length, 1);

    const after = await fetch(
      `http://localhost:${PORT}/quotes/${q.id}/public`,
    ).then((r) => r.json());
    assertEquals(payNowTarget(after), {
      invoiceId: billed[0].id,
      number: after.invoices[0].number,
      url: `/i/${billed[0].id}`,
      balanceCents: 4_800_00,
    });
  } finally {
    await server.stop();
    await resetKv();
  }
});
