/**
 * REQ-954 (LOOP-007 cycle 1, q1-26) — "Deposit deadline: 'First invoice due
 * in 7 days' vs 'Before work starts'". Drives the real app over HTTP: the
 * customer signs a "Deposit + balance" quote that starts next week; the
 * signed-confirmation email in the outbox, the deposit invoice's public JSON
 * (GET /invoices/:id/public) and the signed /q projection
 * (GET /quotes/:id/public) must all name the SAME deposit deadline. Today the
 * email prints the fixed "due in 7 days · pay online" instead of the date.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { shortDate } from "#documents/linked-view.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;
const JSON_HEADERS = { "content-type": "application/json" };

async function login(phone = "+15125558954"): Promise<string> {
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

Deno.test("REQ-954 (LOOP-007 q1-26): accept a Deposit + balance quote starting next week — the confirmation email, the deposit invoice and the signed /q name the same deposit due date", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
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
    const sid = await login();
    const auth = { ...JSON_HEADERS, "x-session-id": sid };
    const customer = await call("POST", "/customers", auth, {
      name: "Dana Whitfield",
      email: "dana@example.com",
    });
    const quote = await call("POST", "/quotes", auth, {
      customerId: customer.id,
      summary: "Kitchen remodel",
      jobName: "Kitchen remodel",
      lineItems: [{
        description: "Kitchen remodel",
        quantity: 1,
        unit: "job",
        price: 23_250_00,
      }],
      estimatedTotal: 23_250_00,
      startDate: plusDaysIso(10),
      estimatedCompletionDate: plusDaysIso(24),
      terms: [{
        stepId: "payment_terms",
        label: "Payment",
        value: "Deposit + balance",
      }],
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
    const linked = (q.invoices ?? []) as { id: string; dueDate?: string }[];
    assertEquals(linked.length, 1, "the signed /q lists the sent deposit");
    const inv = await call("GET", `/invoices/${linked[0].id}/public`, {});
    const due: string | undefined = inv.dueDate;
    assert(due, "the deposit invoice has a due date");
    assertEquals(linked[0].dueDate, due, "/q and the invoice agree");

    const confirm = outbox.find((m) => m.to === "dana@example.com");
    assert(confirm, `the signed-confirmation email went out: ${outbox.length}`);
    const text = emailText(confirm.htmlBody);
    const short = shortDate(due, "en", false); // "Nov 25"
    const [mon, day] = short.split(" ");
    assert(
      new RegExp(`\\b${mon}[a-z]*\\.? ${day}\\b`).test(text),
      `the confirmation email names the deposit's due date ${due} (${short}); it says: ${
        text.match(/First invoice.{0,80}/)?.[0] ?? text
      }`,
    );
  } finally {
    await server.stop();
    EmailService.prototype.send = realSend;
    await resetKv();
  }
});
