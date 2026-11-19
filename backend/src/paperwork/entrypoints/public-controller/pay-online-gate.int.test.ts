/**
 * REQ-1054 (LOOP-007 cycle 2, q2-37) — "Signed email and /q say 'pay online'
 * but /i says to contact the contractor (no online payment set up)".
 *
 * Drives the real app over HTTP. A fresh account with no payment methods and
 * no Stripe/Square: the customer signs on the public accept endpoint. /i's
 * inputs (GET /invoices/:id/public → acceptedMethods [], GET /invoices/:id/card
 * → not available) put that page on its "contact your contractor" fallback, so
 *   - the signed-confirmation email in the outbox must not say "pay online",
 *   - the signed /q payload (GET /quotes/:id/public) must say `payOnline: false`
 *     (quote-doc.tsx then shows no "Pay now").
 * The same flow for an account that takes Venmo keeps "pay online" and
 * `payOnline: true`.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;
const JSON_HEADERS = { "content-type": "application/json" };

async function login(phone: string): Promise<string> {
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

const plusDaysIso = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function emailText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

const around = (text: string) =>
  text.match(/.{0,40}(pay online|\bdue\b).{0,30}/i)?.[0] ?? text.slice(0, 200);

/** Sign a sent quote on a fresh account; return the email, /q and /i facts. */
async function signOn(
  outbox: SendEmailInput[],
  phone: string,
  to: string,
  methods?: Record<string, unknown>,
) {
  const sid = await login(phone);
  const auth = { ...JSON_HEADERS, "x-session-id": sid };
  const owner = (await new SessionStore().get(sid))!;
  await new BusinessIdentityStore().upsert(owner.userId, {
    businessName: "Northside Builders",
    ...(methods ? { acceptedPaymentMethods: methods } : {}),
  } as never);
  const customer = await call("POST", "/customers", auth, {
    name: "Dana Whitfield",
    email: to,
  });
  const quote = await call("POST", "/quotes", auth, {
    customerId: customer.id,
    summary: "Kitchen remodel",
    jobName: "Kitchen remodel",
    lineItems: [{
      description: "Kitchen remodel",
      quantity: 1,
      unit: "job",
      price: 2_520_00,
    }],
    estimatedTotal: 2_520_00,
    estimatedCompletionDate: plusDaysIso(10),
  });
  await call("PUT", `/quotes/${quote.id}`, auth, { status: "sent" });
  const accepted = await call(
    "POST",
    `/quotes/${quote.id}/accept`,
    JSON_HEADERS,
    {
      name: "Dana Whitfield",
      signature: "data:image/png;base64,iVBORw0KGgo=",
    },
  );
  assertEquals(accepted.ok, true);
  const q = await call("GET", `/quotes/${quote.id}/public`, {});
  const linked = (q.invoices ?? []) as { id: string }[];
  assertEquals(linked.length, 1, "the signed /q lists the first invoice");
  const inv = await call("GET", `/invoices/${linked[0].id}/public`, {});
  const card: { available?: boolean } = await fetch(
    `${base()}/invoices/${linked[0].id}/card`,
  )
    .then((r) => r.ok ? r.json() : {}).catch(() => ({}));
  const mail = outbox.find((m) => m.to === to);
  assert(mail, `the signed-confirmation email went out (${outbox.length})`);
  return { q, inv, card, text: emailText(mail.htmlBody) };
}

Deno.test("REQ-1054 (LOOP-007 q2-37): sign on an account with no online pay way — /i falls back to 'contact your contractor', and neither the signed email nor the signed /q promise online payment; with Venmo both do", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  await resetKv();
  const outbox: SendEmailInput[] = [];
  const realSend = EmailService.prototype.send;
  EmailService.prototype.send = function (input: SendEmailInput) {
    outbox.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    // ── no methods, no Stripe, no Square ──
    const none = await signOn(outbox, "+15125551054", "dana@example.com");
    // /i's inputs: no accepted methods and no card → PublicInvoiceClaim
    // renders claim-no-methods ("contact your contractor")
    assertEquals(none.inv.acceptedMethods ?? [], [], "/i: no accepted methods");
    assertEquals(!!none.card.available, false, "/i: no card");
    assert(
      !/pay online/i.test(none.text),
      `/i says "contact your contractor", yet the signed email says: ${
        around(none.text)
      }`,
    );
    assertEquals(
      none.q.payOnline,
      false,
      "the signed /q payload says the customer cannot pay online (so no 'Pay now')",
    );

    // ── the business takes Venmo ──
    const venmo = await signOn(
      outbox,
      "+15125551055",
      "lee@example.com",
      { venmo: { enabled: true, handle: "@northside" } },
    );
    assert(
      (venmo.inv.acceptedMethods ?? []).some((m: { method: string }) =>
        m.method === "venmo"
      ),
      "/i offers Venmo",
    );
    assert(
      /pay online/i.test(venmo.text),
      `Venmo is an online way to pay: ${around(venmo.text)}`,
    );
    assertEquals(venmo.q.payOnline, true, "/q: Venmo → payOnline");
  } finally {
    await server.stop();
    EmailService.prototype.send = realSend;
    await resetKv();
  }
});
