/**
 * REQ-684 — demo-loop cycle 5 (run r37f88707), issue m39: a change order made
 * by hand (POST /invoices/:id/change-orders) emailed and texted the customer,
 * but the controller fired the alert and forgot it, so the panel could only
 * say "CO-001 created — the customer approves it at its own link". Pair 5
 * concluded CO-001 "was not auto-sent"; pair 3 asked "did Maria get anything?".
 *
 * Over HTTP on the booted app: create and edit both answer with the order AND
 * its `delivery` — what reached the customer, channel by channel (the chat's
 * REQ-456 facts); a customer with nothing on file gets a `delivery` with
 * neither address, so the panel says "nothing sent — share the link".
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule] })
class TestApp {}

// dev mode for both channels: email and text "send" without a provider
Deno.env.delete("POSTMARK_API_KEY");
Deno.env.delete("TWILIO_ACCOUNT_SID");

const PORT = 43000 + Math.floor(Math.random() * 2000);
const BASE = `http://localhost:${PORT}`;
const json = { "content-type": "application/json" };

async function login(phone = "+15125550684"): Promise<Record<string, string>> {
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

async function send(
  method: string,
  path: string,
  headers: Record<string, string>,
  body: unknown,
) {
  const r = await fetch(`${BASE}${path}`, {
    method,
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

async function invoiceFor(
  auth: Record<string, string>,
  customer: Record<string, unknown>,
) {
  const c = await send("POST", "/customers", auth, customer);
  assert(c.status < 300, JSON.stringify(c.body));
  const inv = await send("POST", "/invoices", auth, {
    status: "sent",
    amount: 7050_00,
    customerId: c.body.id,
    jobName: "Bathroom Remodel",
  });
  assert(inv.status < 300, JSON.stringify(inv.body));
  return inv.body.id as string;
}

Deno.test({
  name:
    "REQ-684 m39 (cycle 5): POST and PUT /invoices/:id/change-orders answer with what reached the customer — emailed, and the text's failure",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withServer(async () => {
      const auth = await login();
      const invoiceId = await invoiceFor(auth, {
        name: "Maria Lopez",
        email: "maria@example.com",
        phoneNumber: "(512) 555-0123", // reserved 555 — never texted
      });
      const created = await send(
        "POST",
        `/invoices/${invoiceId}/change-orders`,
        auth,
        { description: "Frameless glass door", deltaAmountCents: 1200_00 },
      );
      assert(created.status < 300, JSON.stringify(created.body));
      assertEquals(created.body.number, "CO-001");
      assertEquals(created.body.status, "pending");
      assertEquals(created.body.delivery?.emailedTo, "maria@example.com");
      assertEquals(created.body.delivery?.textedTo, undefined);
      // REQ-588: the text's failure is a worded sentence, never the raw key.
      // REQ-684 AMENDMENT (reconciled on demo-fixes with REQ-681): a 555 number is never texted —
      // the alert reports it as skipped (smsSkippedReason), not as a failed text
      assertEquals(created.body.delivery?.smsFailureReason, undefined);
      const smsWhy = created.body.delivery?.smsSkippedReason ?? "";
      assert(smsWhy.includes("555"), `the text's failure is named: ${smsWhy}`);
      assert(!smsWhy.startsWith("sms."), "never the raw sms.* key");

      const edited = await send(
        "PUT",
        `/invoices/${invoiceId}/change-orders/${created.body.id}`,
        auth,
        {
          description: "Frameless glass door, 10mm",
          deltaAmountCents: 1000_00,
        },
      );
      assert(edited.status < 300, JSON.stringify(edited.body));
      assertEquals(edited.body.version, 2);
      assertEquals(edited.body.delivery?.emailedTo, "maria@example.com");
    }),
});

Deno.test({
  name:
    "REQ-684 m39 (cycle 5): a customer with no email or phone → the CO's delivery names neither (nothing sent — share the link)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withServer(async () => {
      const auth = await login("+15125550685");
      const invoiceId = await invoiceFor(auth, { name: "No Contact Nick" });
      const created = await send(
        "POST",
        `/invoices/${invoiceId}/change-orders`,
        auth,
        { description: "Extra outlet", deltaAmountCents: 150_00 },
      );
      assert(created.status < 300, JSON.stringify(created.body));
      assert(created.body.delivery, "the delivery is on the response");
      assertEquals(created.body.delivery.emailedTo, undefined);
      assertEquals(created.body.delivery.textedTo, undefined);
      assertEquals(created.body.delivery.error, undefined);
    }),
});
