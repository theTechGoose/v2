/**
 * REQ-1121 (LOOP-007 cycle 3, issue q3-44; amends REQ-1054) over HTTP on the
 * booted app. QA5: on a Spanish account with no online pay way, the invoice
 * email had "Ver y pagar factura →" and the part-payment receipt "Pagar saldo
 * →", while the /i page both buttons open says "Contacta a tu contratista para
 * coordinar el pago." (GET /invoices/:id/public → acceptedMethods [] and
 * /invoices/:id/card not available — REQ-1054's no-online-pay fallback).
 *
 *  - no methods, no Stripe/Square: POST /invoices/:id/email then a $400 check
 *    part payment (POST /payments) → neither the invoice email nor the receipt
 *    (as captured AND as stored in the outbox) carries a pay CTA
 *  - the same flow on a Venmo account keeps both pay CTAs
 *
 * Only the email provider is captured (EmailService.send).
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { t } from "@core/i18n/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";

@Module({
  imports: [UsersModule, CrmModule, CommunicationModule, PaperworkModule],
})
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;
const json = { "content-type": "application/json" };

const mails: SendEmailInput[] = [];
EmailService.prototype.send = function (input: SendEmailInput) {
  mails.push(input);
  return Promise.resolve({ ok: true, messageId: `pm-${mails.length}` });
};

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
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(out)}`);
  return out;
}

async function account(phone: string, ownerEmail: string, methods?: Record<string, unknown>) {
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
  const owner = (await new SessionStore().get(v.sessionId))!;
  await new UserStore().update(owner.userId, { name: "Luis Ortega", email: ownerEmail });
  await new BusinessIdentityStore().upsert(owner.userId, {
    businessName: "Pisos Ortega LLC",
    commsLanguage: "es",
    ...(methods ? { acceptedPaymentMethods: methods } : {}),
  } as never);
  return auth;
}

type Facts = {
  publicMethods: unknown[];
  invoiceHtml: string;
  receiptHtml: string;
  outboxInvoice: string;
  outboxReceipt: string;
};

/** a $1,000 invoice emailed in Spanish, then a $400 check part payment */
async function invoiceThenPartPayment(
  auth: Record<string, string>,
  customerEmail: string,
): Promise<Facts> {
  const customer = await call("POST", "/customers", auth, {
    name: "María López",
    email: customerEmail,
  });
  const inv = await call("POST", "/invoices", auth, {
    customerId: customer.id,
    jobName: "Piso de cocina",
    amount: 100000,
    status: "sent",
    dueDate: "2026-12-31",
  });
  mails.length = 0;
  const sent = await call("POST", `/invoices/${inv.id}/email`, auth, { language: "es" });
  assert(sent.ok !== false, `the invoice email went out: ${JSON.stringify(sent)}`);
  const invoiceMail = mails.find((m) => m.to === customerEmail);
  assert(invoiceMail, `the invoice email was captured (${mails.length})`);

  mails.length = 0;
  await call("POST", "/payments", auth, {
    invoiceId: inv.id,
    amount: 40000,
    method: "check",
    receivedAt: new Date().toISOString(),
  });
  const receiptMail = mails.find((m) => m.to === customerEmail);
  assert(receiptMail, `the receipt email was captured (${mails.length})`);

  const pub = await call("GET", `/invoices/${inv.id}/public`, {});
  const rows = (await call("GET", "/outbox", auth)) as { id: string; kind: string; channel: string }[];
  const bodyOf = async (kind: string) => {
    const row = rows.find((r) => r.kind === kind && r.channel === "email");
    assert(row, `an outbox ${kind} email row (${rows.map((r) => `${r.kind}:${r.channel}`).join(", ")})`);
    return ((await call("GET", `/outbox/${row.id}`, auth)) as { body?: string }).body ?? "";
  };
  return {
    publicMethods: (pub.acceptedMethods ?? []) as unknown[],
    invoiceHtml: invoiceMail.htmlBody ?? "",
    receiptHtml: receiptMail.htmlBody ?? "",
    outboxInvoice: await bodyOf("invoice"),
    outboxReceipt: await bodyOf("receipt"),
  };
}

const INVOICE_CTA = t("es", "paperworkEmail.invoice.cta"); // "Ver y pagar factura"
const RECEIPT_CTA = t("es", "confirmPayment.email.payCta"); // "Pagar saldo →"

function payCtaLeaks(f: Facts): string[] {
  const leaks: string[] = [];
  if (f.invoiceHtml.includes(INVOICE_CTA)) leaks.push(`invoice email: "${INVOICE_CTA}"`);
  if (f.outboxInvoice.includes(INVOICE_CTA)) leaks.push(`outbox invoice: "${INVOICE_CTA}"`);
  if (f.receiptHtml.includes(RECEIPT_CTA)) leaks.push(`receipt email: "${RECEIPT_CTA}"`);
  if (f.outboxReceipt.includes(RECEIPT_CTA)) leaks.push(`outbox receipt: "${RECEIPT_CTA}"`);
  return leaks;
}

Deno.test("REQ-1121 (LOOP-007 q3-44): no online pay way — the emailed invoice and the part-payment receipt (sent and in the outbox) carry no pay CTA; on a Venmo account both do", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    // ── no methods, no Stripe, no Square: /i falls back to "contact your contractor" ──
    const bare = await account("+15125551121", "luis.bare@test.dev");
    const none = await invoiceThenPartPayment(bare, "maria.bare@test.dev");
    assertEquals(none.publicMethods.length, 0, "precondition: /i has no way to pay online");

    // ── Venmo: /i offers payment, so the emails may ask for it ──
    const venmo = await account("+15125552121", "luis.venmo@test.dev", {
      venmo: { enabled: true, handle: "@pisosortega" },
    });
    const withVenmo = await invoiceThenPartPayment(venmo, "maria.venmo@test.dev");
    assert(
      withVenmo.invoiceHtml.includes(INVOICE_CTA) && withVenmo.receiptHtml.includes(RECEIPT_CTA),
      "Venmo is an online way to pay: both emails keep their pay CTA",
    );

    const leaks = payCtaLeaks(none);
    assert(
      leaks.length === 0,
      `/i says "Contacta a tu contratista", yet the emails promise online payment: ${leaks.join(" | ")}`,
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
