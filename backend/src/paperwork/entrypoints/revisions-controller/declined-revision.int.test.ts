/**
 * REQ-1026 (LOOP-007 cycle 2, q2-5) — "Publish revision and notify customer"
 * on a DECLINED quote reopens it, so the Version 2 the customer is texted
 * about can be signed. Raphael: "test every single aspect of this application
 * … one Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green."
 *
 * The demo: Q-002 was declined; the contractor followed the REQ-948 alert
 * ("revise the quote and send it again"), published Version 2 with notify;
 * the customer got "Q-002 · Versión 2 está lista", but /q said "Versión 2 ·
 * Rechazada" with no signing section, and POST accept answers 409 declined.
 *
 * Integration over HTTP with the app booted (KV :memory:); the email and SMS
 * transports are captured at their prototype.
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
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({
  imports: [UsersModule, CrmModule, PaperworkModule, CommunicationModule],
})
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;
const J = { "content-type": "application/json" };

const CONTRACTOR_PHONE = "+15125559581";
const CONTRACTOR_EMAIL = "rafa.builder@example.com";
const CUSTOMER_PHONE = "+15125559582";
const CUSTOMER_EMAIL = "jorge.ruiz@example.com";

const emails: SendEmailInput[] = [];
const texts: SendSmsInput[] = [];
const digitsOf = (s: string) => s.replace(/\D/g, "").slice(-10);
const textsTo = (to: string, from = 0) =>
  texts.slice(from).filter((m) => digitsOf(String(m.to)) === digitsOf(to));
const emailsTo = (to: string, from = 0) =>
  emails.slice(from).filter((e) =>
    String(e.to).toLowerCase().includes(to.toLowerCase())
  );

async function drain(res: Response) {
  await res.body?.cancel();
}
function auth(sid: string) {
  return { ...J, "x-session-id": sid };
}
async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch { /* not json */ }
  return { status: res.status, body: json };
}

async function login(phone: string): Promise<string> {
  await drain(
    await fetch(`${BASE}/auth/send-otp`, {
      method: "POST",
      headers: J,
      body: JSON.stringify({ phoneNumber: phone }),
    }),
  );
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function boot() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  emails.length = 0;
  texts.length = 0;
  const origEmail = EmailService.prototype.send;
  const origSms = SmsService.prototype.send;
  EmailService.prototype.send = function (input: SendEmailInput) {
    emails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  } as typeof origEmail;
  SmsService.prototype.send = function (input: SendSmsInput) {
    texts.push(input);
    return Promise.resolve({ ok: true });
  } as typeof origSms;
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  return {
    async stop() {
      await server.stop();
      EmailService.prototype.send = origEmail;
      SmsService.prototype.send = origSms;
      await resetKv();
    },
  };
}

/** Q-001 sent to Jorge, declined by him, then a line added (pending). */
async function declinedQuoteWithRevision() {
  const sid = await login(CONTRACTOR_PHONE);
  const owner = (await new SessionStore().get(sid))!;
  await new UserStore().update(owner.userId, {
    name: "Rafa Castro",
    email: CONTRACTOR_EMAIL,
    language: "en",
  } as never);
  const c = await call("POST", "/customers", auth(sid), {
    name: "Jorge Ruiz",
    email: CUSTOMER_EMAIL,
    phoneNumber: CUSTOMER_PHONE,
    address: "1 Main St",
  });
  assertEquals(c.status < 300, true, JSON.stringify(c.body));
  const line = {
    description: "Roof tear-off",
    quantity: 1,
    unit: "job",
    price: 900_000,
  };
  const q = await call("POST", "/quotes", auth(sid), {
    summary: "Roof replacement",
    customerId: c.body.id,
    lineItems: [line],
    estimatedTotal: 900_000,
  });
  const id = q.body.id as string;
  assert(id, JSON.stringify(q.body));
  const sent = await call("PUT", `/quotes/${id}`, auth(sid), {
    status: "sent",
  });
  assertEquals(sent.status, 200, JSON.stringify(sent.body));

  const declined = await call("POST", `/quotes/${id}/decline`, J, {
    reason: "price",
    note: "Too expensive",
    name: "Jorge Ruiz",
  });
  assertEquals(declined.status, 200, JSON.stringify(declined.body));
  const v1 = await call("GET", `/quotes/${id}/public`, J);
  assertEquals(v1.body.status, "lost", "setup: Version 1 is declined");

  const edit = await call("PUT", `/quotes/${id}`, auth(sid), {
    lineItems: [line, {
      description: "Gutter guards",
      quantity: 1,
      unit: "job",
      price: 120_000,
    }],
    estimatedTotal: 1_020_000,
  });
  assertEquals(edit.status, 200, JSON.stringify(edit.body));
  assert(edit.body.pendingRevision, "setup: the edit waits as a revision");
  return { sid, id };
}

Deno.test("REQ-1026 (LOOP-007 q2-5): publishing + notifying a revision of a declined quote reopens it — /public reads Version 2 'revised' with no signRefusal, and the customer can sign it (accept 200, not 409 declined)", async () => {
  const app = await boot();
  try {
    const { sid, id } = await declinedQuoteWithRevision();
    const mark = texts.length;

    const pub = await call("POST", `/quotes/${id}/publish`, auth(sid), {
      notify: true,
    });
    assertEquals(pub.status, 200, JSON.stringify(pub.body));
    assertEquals(pub.body.version, 2);
    assertEquals(
      textsTo(CUSTOMER_PHONE, mark).length,
      1,
      "the customer is texted that Version 2 is ready",
    );
    assertEquals(
      pub.body.status === "lost",
      false,
      `the published Version 2 is no longer 'lost' (status ${pub.body.status}, lostAt ${pub.body.lostAt})`,
    );

    const v2 = await call("GET", `/quotes/${id}/public`, J);
    assertEquals(v2.status, 200);
    assertEquals(v2.body.version, 2);
    assertEquals(
      v2.body.state,
      "revised",
      "the /q headline reads 'Versión 2 · Revisada', not 'Rechazada'",
    );
    assertEquals(
      v2.body.signRefusal,
      undefined,
      "nothing refuses the signature",
    );

    const accept = await call("POST", `/quotes/${id}/accept`, J, {
      name: "Jorge Ruiz",
      version: 2,
    });
    assertEquals(
      accept.status,
      200,
      `the customer can sign Version 2: ${JSON.stringify(accept.body)}`,
    );
    const signed = await call("GET", `/quotes/${id}/public`, J);
    assertEquals(signed.body.status, "accepted");
  } finally {
    await app.stop();
  }
});

Deno.test("REQ-1026 (LOOP-007 q2-5): a reopened Version 2 declined again alerts the contractor again (REQ-948's declineNotifiedAt vs lostAt guard)", async () => {
  const app = await boot();
  try {
    const { sid, id } = await declinedQuoteWithRevision();
    const pub = await call("POST", `/quotes/${id}/publish`, auth(sid), {
      notify: true,
    });
    assertEquals(pub.status, 200, JSON.stringify(pub.body));

    const mark = { t: texts.length, e: emails.length };
    const again = await call("POST", `/quotes/${id}/decline`, J, {
      reason: "timing",
      name: "Jorge Ruiz",
    });
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assertEquals(
      again.body.alreadyDeclined,
      undefined,
      "Version 2's decline is a new decision, not 'already declined'",
    );
    assertEquals(
      textsTo(CONTRACTOR_PHONE, mark.t).length,
      1,
      "the contractor is texted about the second decline",
    );
    assertEquals(
      emailsTo(CONTRACTOR_EMAIL, mark.e).length,
      1,
      "the contractor is emailed about the second decline",
    );
  } finally {
    await app.stop();
  }
});
