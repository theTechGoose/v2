/**
 * REQ-937 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green." LOOP-007 cycle 1, issue q1-4:
 * "Publish revision" re-sends a Spanish customer's quote in English.
 *
 * Version 1 went out in Español (SendQuote records quote.lastDelivery.lang
 * = "es"). Publishing Version 2 with notify must re-send it in the language
 * it last went out in, not the account default — and an explicit per-send
 * pick still wins.
 *
 * Integration over HTTP, app booted, KV :memory:. Only the email provider is
 * captured (EmailService.prototype.send).
 */
import "#reflect-metadata";
import { assertEquals, assertMatch, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

async function drain(res: Response) {
  await res.body?.cancel();
}
function auth(sid: string) {
  return { "content-type": "application/json", "x-session-id": sid };
}
async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  return await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
async function login(phone = "+15125550937"): Promise<string> {
  await drain(
    await call("POST", "/auth/send-otp", { "content-type": "application/json" }, {
      phoneNumber: phone,
    }),
  );
  const stored = await new OtpStore().get(phone);
  const v = await call(
    "POST",
    "/auth/verify-otp",
    { "content-type": "application/json" },
    { phoneNumber: phone, code: stored!.code },
  ).then((r) => r.json());
  // An English-UI owner, English account default.
  await drain(
    await call("PUT", "/me", auth(v.sessionId), {
      name: "Rafa Castro",
      language: "en",
    }),
  );
  return v.sessionId;
}

/** Boot the app and capture every email the provider is handed. */
async function withServer(
  fn: (emails: SendEmailInput[]) => Promise<void>,
) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const emails: SendEmailInput[] = [];
  const realSend = EmailService.prototype.send;
  EmailService.prototype.send = function (input: SendEmailInput) {
    emails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(emails);
  } finally {
    EmailService.prototype.send = realSend;
    await server.stop();
    await resetKv();
  }
}

/** Q-001 to Jose (no language of his own), Version 1 sent in Español, with a pending Version 2. */
async function spanishSentQuoteWithRevision(sid: string) {
  const me = await call("GET", "/me", auth(sid)).then((r) => r.json());
  const userId: string = me.id ?? me.user?.id;
  const c = await call("POST", "/customers", auth(sid), {
    name: "Jose Martinez",
    email: "jose@example.com",
    address: "1 Main St",
  }).then((r) => r.json());
  const q = await call("POST", "/quotes", auth(sid), {
    summary: "Roof replacement",
    customerId: c.id,
    lineItems: [{
      description: "Shingles",
      quantity: 1,
      unit: "job",
      price: 100000,
    }],
    estimatedTotal: 100000,
  }).then((r) => r.json());
  await drain(await call("PUT", `/quotes/${q.id}`, auth(sid), { status: "sent" }));
  // What SendQuote records for a "Sends in: Español" send (send-quote/mod.ts).
  await new QuoteStore().update(q.id, userId, {
    lastDelivery: {
      at: new Date().toISOString(),
      channel: "email",
      emailedTo: "jose@example.com",
      lang: "es",
    },
  });
  const edited = await call("PUT", `/quotes/${q.id}`, auth(sid), {
    lineItems: [{ ...q.lineItems[0] }, {
      description: "Gutter guards",
      quantity: 1,
      unit: "ea",
      price: 50000,
    }],
    estimatedTotal: 150000,
  }).then((r) => r.json());
  assertEquals(
    Boolean(edited.pendingRevision),
    true,
    "a sent quote's edit waits as a revision",
  );
  return q;
}

Deno.test("REQ-937 (LOOP-007 q1-4): publishing Version 2 with notify and no language re-sends it in Spanish, the language Version 1 went out in", async () => {
  await withServer(async (emails) => {
    const sid = await login();
    const q = await spanishSentQuoteWithRevision(sid);
    const res = await call("POST", `/quotes/${q.id}/publish`, auth(sid), {
      notify: true,
    });
    assertEquals(res.status, 200);
    assertEquals((await res.json()).version, 2);
    assertEquals(emails.length, 1, "one email for the publish");
    const mail = emails[0];
    assertMatch(mail.subject, /^Cotización Q-001 /, mail.subject);
    assertStringIncludes(mail.htmlBody, '<html lang="es">');
    assertMatch(mail.htmlBody, /[?&]lang=es\b/);
  });
});

Deno.test("REQ-937 (LOOP-007 q1-4): an explicit per-send pick still wins — publish {notify, language:'en'} goes out in English", async () => {
  await withServer(async (emails) => {
    const sid = await login();
    const q = await spanishSentQuoteWithRevision(sid);
    const res = await call("POST", `/quotes/${q.id}/publish`, auth(sid), {
      notify: true,
      language: "en",
    });
    assertEquals(res.status, 200);
    assertEquals(emails.length, 1);
    const mail = emails[0];
    assertMatch(mail.subject, /^Quote Q-001 /, mail.subject);
    assertStringIncludes(mail.htmlBody, '<html lang="en">');
  });
});
