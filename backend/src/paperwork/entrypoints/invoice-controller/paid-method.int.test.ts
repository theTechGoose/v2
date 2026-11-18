/**
 * REQ-928 — Raphael: "when an invoice is paid, it should show the method of
 * payment and when it was paid in all views. print electronic or other."
 * The invoice API (owner list + one, the customer's public read) carries
 * `paidAt` + `paidMethods`; a paid invoice from before REQ-928 has its
 * methods filled from its payment rows.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AnalyticsModule] })
class TestApp {}

const PORT = 9928;
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

async function login(phone: string): Promise<{ sid: string; userId: string }> {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const sid = v.body.sessionId as string;
  await call("PUT", "/me", { name: "Paid Owner", language: "en" }, sid);
  const me = await call("GET", "/me", undefined, sid);
  return { sid, userId: me.body.id ?? me.body.user?.id };
}

Deno.test("REQ-928: a paid invoice says how and when it was paid on every read", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const { sid, userId } = await login("+15555559281");
    const inv = (await call("POST", "/invoices", {
      amount: 25000,
      jobName: "Gutter clean",
      billTo: { name: "Rosa Diaz" },
      status: "sent",
    }, sid)).body;
    const pay = await call("POST", "/payments", {
      invoiceId: inv.id,
      amount: 25000,
      method: "zelle",
      receivedAt: "2026-11-11T15:00:00.000Z",
    }, sid);
    assertEquals(pay.status < 300, true, JSON.stringify(pay.body));

    const one = (await call("GET", `/invoices/${inv.id}`, undefined, sid)).body;
    assertEquals([one.status, one.paidAt, one.paidMethods], [
      "paid",
      "2026-11-11T15:00:00.000Z",
      ["zelle"],
    ]);
    const list = (await call("GET", "/invoices", undefined, sid)).body as {
      id: string;
      paidMethods?: string[];
    }[];
    assertEquals(list.find((i) => i.id === inv.id)?.paidMethods, ["zelle"]);
    const pub = (await call("GET", `/invoices/${inv.id}/public`)).body;
    assertEquals([pub.paidAt, pub.paidMethods], ["2026-11-11T15:00:00.000Z", [
      "zelle",
    ]]);

    // a PUT can't forge it
    await call("PUT", `/invoices/${inv.id}`, { paidMethods: ["cash"] }, sid);
    assertEquals(
      (await call("GET", `/invoices/${inv.id}`, undefined, sid)).body
        .paidMethods,
      ["zelle"],
    );

    // paid before REQ-928: no paidMethods stored — filled from its payment row
    const legacy = await new InvoiceStore().create(userId, {
      amount: 9000,
      jobName: "Old job",
      status: "paid",
      paidAt: "2026-10-01T12:00:00.000Z",
    } as never);
    await new PaymentStore().create(userId, {
      invoiceId: legacy.id,
      amount: 9000,
      method: "check",
      receivedAt: "2026-10-01T12:00:00.000Z",
    });
    assertEquals(
      (await call("GET", `/invoices/${legacy.id}`, undefined, sid)).body
        .paidMethods,
      ["check"],
    );
    const list2 = (await call("GET", "/invoices", undefined, sid)).body as {
      id: string;
      paidMethods?: string[];
    }[];
    assertEquals(list2.find((i) => i.id === legacy.id)?.paidMethods, ["check"]);
    assertEquals(
      (await call("GET", `/invoices/${legacy.id}/public`)).body.paidMethods,
      ["check"],
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
