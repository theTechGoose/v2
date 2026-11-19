/**
 * REQ-1109 — LOOP-007 cycle 3, q3-35: over HTTP, app booted, a $225.30
 * overdue invoice — POST /cron/reminder-preview (the Remind dialog) and
 * POST /cron/invoice-reminder (Send nudge) — must name $225.30, never the
 * malformed "$225.3", in the preview text and in the email the outbox
 * recorded as sent.
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

const iso = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

Deno.test("REQ-1109 (LOOP-007 q3-35) int: the reminder preview and the sent nudge email for a $225.30 overdue invoice read $225.30, never $225.3", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125551109");
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
        lineItems: [{ description: "Gutter repair", quantity: 1, price: 225_30 }],
        amount: 225_30,
        dueDate: iso(-10),
      }),
    }).then((r) => r.json());

    const pv = await fetch(`${base()}/cron/reminder-preview`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({ invoiceId: created.id, day: 7 }),
    });
    assertEquals(pv.status, 200);
    const preview = await pv.json();
    const previewText = String(preview.smsBody);

    const res = await fetch(`${base()}/cron/invoice-reminder`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({ invoiceId: created.id, day: 7 }),
    });
    assertEquals(res.status, 200);
    const out = await res.json();
    assertEquals(out.channels, ["email"], `the nudge went by email (${JSON.stringify(out)})`);

    const rows = await fetch(`${base()}/outbox`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json()) as Array<{ id: string; channel?: string }>;
    assert(rows.length > 0, "the nudge email is in the outbox");
    const bodies: string[] = [];
    for (const row of rows) {
      const one = await fetch(`${base()}/outbox/${row.id}`, {
        headers: { "x-session-id": sid },
      }).then((r) => r.json());
      bodies.push(String(one.body ?? ""));
    }
    const mail = bodies.find((b) => b.includes("$225.3"));
    assert(mail, `no outbox body names the amount (${bodies.map((b) => b.slice(0, 120)).join(" | ")})`);
    const wrong: string[] = [];
    if (!previewText.includes("$225.30")) wrong.push(`the Remind dialog preview drops the cent zero: "${previewText}"`);
    if (!mail.includes("$225.30")) {
      wrong.push(`the sent nudge email drops the cent zero: ${mail.match(/\$[\d,.]+/g)?.join(" ")}`);
    }
    assert(wrong.length === 0, wrong.join("\n"));
  } finally {
    await server.stop();
    await resetKv();
  }
});
