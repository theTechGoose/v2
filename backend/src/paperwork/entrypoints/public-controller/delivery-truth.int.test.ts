/**
 * REQ-556 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue M7: the app said something was sent or
 * nudged when nothing could be delivered —
 *   - pair 9: after the payment was confirmed, /invoices "El recibo se envió
 *     automáticamente." and /i "Un recibo en PDF está en tu correo" for a
 *     client with no email and a 555-01XX test number;
 *   - pair 7: INV-001 billed at signing "went out automatically" a minute
 *     after the text to the test number failed;
 *   - pair 10: "Send a nudge" on an invoice with no recipient → "Already
 *     nudged today".
 *
 * End to end over HTTP, app booted, email + SMS in dev mode (what the demo
 * ran on): the delivery results reach the API the pages read —
 * `receiptSentVia` on the public invoice, `deliveredVia` on the billed
 * milestone (with the signer's Pay now kept, REQ-251), and the nudge's
 * `reason`.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { payNowTarget } from "#documents/linked-view.ts";

@Module({ imports: [UsersModule, PaperworkModule, CommunicationModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;
const J = { "content-type": "application/json" };

async function login(phone: string): Promise<string> {
  await (await fetch(`${base()}/auth/send-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base()}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function customerFor(
  sid: string,
  c: { name: string; phoneNumber?: string; email?: string },
): Promise<string> {
  const owner = (await new SessionStore().get(sid))!;
  return (await new CustomerStore().create(owner.userId, c)).id;
}

async function invoiceFor(
  sid: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`${base()}/invoices`, {
    method: "POST",
    headers: { ...J, "x-session-id": sid },
    body: JSON.stringify({
      status: "sent",
      lineItems: [{ description: "Panel upgrade", quantity: 1, price: 450_00 }],
      amount: 450_00,
      // REQ-550: an issued invoice needs a customer or a bill-to name
      billTo: { name: "Pat Doe" },
      ...body,
    }),
  });
  const inv = await res.json();
  assertEquals(res.status < 300, true, `create → ${res.status}`);
  return inv.id as string;
}

Deno.test("REQ-556 (M7) e2e: signing, paying and nudging a client nothing can reach — the API records that nothing was delivered", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125552556");
    // pair 7 / pair 9's client: no email, a fictional 555-01XX number
    const garcia = await customerFor(sid, {
      name: "Mrs Garcia",
      phoneNumber: "5125550142",
    });

    // ---- signing (pair 7)
    const q = await fetch(`${base()}/quotes`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({
        summary: "Bathroom remodel",
        lineItems: [],
        customerId: garcia,
        estimatedTotal: 4_800_00,
        terms: [{ stepId: "payment_terms", value: "Due Now" }],
      }),
    }).then((r) => r.json());
    await (await fetch(`${base()}/quotes/${q.id}`, {
      method: "PUT",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({ status: "sent" }),
    })).body?.cancel();
    const accepted = await fetch(`${base()}/quotes/${q.id}/accept`, {
      method: "POST",
      headers: J,
      body: JSON.stringify({ name: "Maria Garcia" }),
    }).then((r) => r.json());
    assertEquals(accepted.ok, true);
    const billed = (await fetch(`${base()}/invoices`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json())).filter((i: { quoteId?: string }) =>
      i.quoteId === q.id
    );
    assertEquals(billed.length, 1);
    assertEquals(
      billed[0].deliveredVia,
      [],
      "the invoice signing billed reached nobody — the record must say so",
    );
    // the signer is still handed the bill on /q (REQ-251)
    const pub = await fetch(`${base()}/quotes/${q.id}/public`).then((r) =>
      r.json()
    );
    assertEquals(payNowTarget(pub)?.invoiceId, billed[0].id);

    // ---- paying (pair 9): claim → confirm
    const inv = await invoiceFor(sid, { customerId: garcia });
    const claim = await fetch(`${base()}/invoices/${inv}/claim-payment`, {
      method: "POST",
      headers: J,
      body: JSON.stringify({ method: "zelle", claimedBy: "Mrs Garcia" }),
    });
    assertEquals(claim.status, 200);
    await claim.body?.cancel();
    const confirm = await fetch(`${base()}/invoices/${inv}/confirm-payment`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: "{}",
    });
    assertEquals(confirm.status < 300, true, `confirm → ${confirm.status}`);
    await confirm.body?.cancel();
    const paid = await fetch(`${base()}/invoices/${inv}/public`).then((r) =>
      r.json()
    );
    assertEquals(paid.status, "paid");
    assertEquals(
      paid.receiptSentVia,
      "none",
      "/i would claim an emailed receipt",
    );
    const own = (await fetch(`${base()}/invoices`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json())).find((i: { id: string }) => i.id === inv);
    assertEquals(
      own.receiptSentVia,
      "none",
      "/invoices would claim a sent receipt",
    );

    // ---- nudging (pair 10): an overdue invoice with no customer
    const orphan = await invoiceFor(sid, { dueDate: "2026-10-01" });
    const nudge = await fetch(`${base()}/cron/invoice-reminder`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({ invoiceId: orphan, day: 14 }),
    }).then((r) => r.json());
    assertEquals(nudge.channels, []);
    assertEquals(nudge.reason, "no_recipient");
  } finally {
    await server.stop();
    await resetKv();
  }
});
