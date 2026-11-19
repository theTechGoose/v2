/**
 * REQ-1113 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green." LOOP-007 cycle 3, issue
 * q3-38: "Remind dialog previews a text, but only an email with different
 * wording goes".
 *
 * Over HTTP, app booted: a customer with an email and a reserved 555-01XX
 * phone. POST /cron/reminder-preview must say only the email goes
 * (channels ["email"], the email's subject + body, no smsBody), and POST
 * /cron/invoice-reminder must agree: it emails, never tries the text, and
 * leaves no "not sent" text row in the Outbox. Before the fix the preview
 * returned the SMS body and the send logged a refused text (NOT TEXTED).
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
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

Deno.test("REQ-1113 (LOOP-007 q3-38) int: a reserved 555-01XX phone + an email → the reminder preview names only email, and the send leaves no refused text in the Outbox", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125551113");
    const owner = (await new SessionStore().get(sid))!;
    const lucia = await new CustomerStore().create(owner.userId, {
      name: "Lucía Gómez",
      email: "lucia@blackhole.postmarkapp.com",
      phoneNumber: "843-555-0142",
    });
    const created = await fetch(`${base()}/invoices`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({
        status: "sent",
        customerId: lucia.id,
        lineItems: [{ description: "Roof patch", quantity: 1, price: 820_67 }],
        amount: 820_67,
        dueDate: iso(-14),
      }),
    }).then((r) => r.json());

    const pv = await fetch(`${base()}/cron/reminder-preview`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({ invoiceId: created.id, day: 14 }),
    });
    assertEquals(pv.status, 200);
    const preview = await pv.json();
    assertEquals(
      preview.channels,
      ["email"],
      `the preview names the one channel that will go (got ${
        JSON.stringify(preview)
      })`,
    );
    assertEquals(preview.smsBody, undefined, "no text is previewed");
    assert(preview.emailSubject, "the email subject is previewed");
    assert(
      typeof preview.emailText === "string" && preview.emailText.length > 0,
      "the email body is previewed",
    );

    const res = await fetch(`${base()}/cron/invoice-reminder`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({ invoiceId: created.id, day: 14 }),
    });
    assertEquals(res.status, 200);
    const out = await res.json();
    assertEquals(
      out.channels,
      preview.channels,
      "the send agrees with the preview",
    );

    const rows = await fetch(`${base()}/outbox?customerId=${lucia.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json()) as { channel: string; status: string }[];
    assertEquals(
      rows.map((r) => `${r.channel}:${r.status}`),
      ["email:sent"],
      `one reminder email and no refused text in the Outbox (got ${
        JSON.stringify(rows)
      })`,
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
