/**
 * REQ-704 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue m60: "Reminders: no
 * before-due option, no preview, wording disagrees with Settings".
 *
 * Over HTTP, app booted: POST /cron/reminder-preview answers the
 * text the customer would get (sending nothing), and POST
 * /cron/invoice-reminder accepts the new before-due (-3) and due-date (0)
 * steps it used to reject.
 */
import "#reflect-metadata";
import { assertEquals, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

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

const iso = (days: number) =>
  new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

Deno.test("REQ-704 m60 e2e: the reminder preview shows what the customer gets, and the nudge accepts the before-due and due-date steps", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125557704");
    const owner = (await new SessionStore().get(sid))!;
    const ana = await new CustomerStore().create(owner.userId, {
      name: "Ana Ruiz",
      email: "ana@blackhole.postmarkapp.com",
    });
    const created = await fetch(`${base()}/invoices`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({
        status: "sent",
        customerId: ana.id,
        lineItems: [{ description: "Gutter repair", quantity: 1, price: 320_00 }],
        amount: 320_00,
        dueDate: iso(10),
      }),
    }).then((r) => r.json());

    const pv = await fetch(`${base()}/cron/reminder-preview`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({ invoiceId: created.id, day: -3 }),
    });
    assertEquals(pv.status, 200);
    const preview = await pv.json();
    assertEquals(preview.day, -3);
    assertEquals(preview.escalated, false);
    assertEquals(preview.email, "ana@blackhole.postmarkapp.com");
    assertStringIncludes(preview.smsBody, "Hi Ana");
    assertStringIncludes(preview.smsBody, "is due soon");
    const untouched = await fetch(`${base()}/invoices/${created.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(untouched.reminderHistory ?? [], [], "a preview sends nothing");

    for (const day of [-3, 0]) {
      const res = await fetch(`${base()}/cron/invoice-reminder`, {
        method: "POST",
        headers: { ...J, "x-session-id": sid },
        body: JSON.stringify({ invoiceId: created.id, day }),
      });
      assertEquals(res.status, 200, `day ${day} is accepted`);
      const out = await res.json();
      assertEquals(out.day, day);
      assertEquals(out.channels, ["email"]);
    }
  } finally {
    await server.stop();
    await resetKv();
  }
});
