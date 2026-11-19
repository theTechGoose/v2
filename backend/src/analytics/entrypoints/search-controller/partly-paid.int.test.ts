/**
 * REQ-1073 (LOOP-007 cycle 2, issue q2-62) over HTTP on the booted app. QA
 * issued INV-001 for $1,190.75 and recorded $500 (POST /payments). The header
 * search then read "INV-001 · Factura / $1,190.75 / Enviada" while the
 * customer's Invoices tab said "Pago parcial". GET /search must say the
 * invoice is partly paid and carry the balance still owed ($690.75).
 *
 * The real app on an in-memory KV; only the email provider is stubbed.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";

@Module({
  imports: [
    UsersModule,
    CrmModule,
    CommunicationModule,
    PaperworkModule,
    AnalyticsModule,
  ],
})
class TestApp {}

const PORT = 19_073;
const BASE = `http://localhost:${PORT}`;
const json = { "content-type": "application/json" };

EmailService.prototype.send = () =>
  Promise.resolve({ ok: true, messageId: "pm-stub" });

async function login(phone = "+15125551073"): Promise<Record<string, string>> {
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
  return { ...json, "x-session-id": v.sessionId };
}

async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

Deno.test("REQ-1073 q2-62: after a $500 payment on a $1,190.75 invoice, GET /search returns it as partly_paid with balanceCents 69075", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const auth = await login();
    const customer = await call("POST", "/customers", auth, {
      name: "Pat Doe",
    });
    assertEquals(customer.status < 400, true, JSON.stringify(customer.body));
    const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(
      0,
      10,
    );
    const inv = await call("POST", "/invoices", auth, {
      customerId: customer.body.id,
      jobName: "Kitchen repaint",
      amount: 119075,
      status: "sent",
      dueDate: due,
    });
    assertEquals(inv.status < 400, true, JSON.stringify(inv.body));

    const pay = await call("POST", "/payments", auth, {
      invoiceId: inv.body.id,
      amount: 50000,
      method: "check",
      receivedAt: new Date().toISOString(),
    });
    assertEquals(pay.status < 400, true, JSON.stringify(pay.body));

    const res = await call(
      "GET",
      `/search?q=${encodeURIComponent(inv.body.number)}`,
      auth,
    );
    assertEquals(res.status, 200, JSON.stringify(res.body));
    const hit = (res.body.results as Array<Record<string, unknown>>).find((
      h,
    ) => h.type === "invoice" && h.id === inv.body.id);
    assertEquals(!!hit, true, `no invoice hit: ${JSON.stringify(res.body)}`);
    assertEquals(
      { status: hit!.status, balanceCents: hit!.balanceCents },
      { status: "partly_paid", balanceCents: 69075 },
      "the search hit says what the customer tab says, and the balance owed",
    );
    assertEquals(hit!.amountCents, 119075, "the total is still there");
  } finally {
    await server.stop();
    await resetKv();
  }
});
