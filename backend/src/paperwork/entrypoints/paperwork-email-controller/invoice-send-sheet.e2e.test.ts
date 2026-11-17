/**
 * REQ-727 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue c4-M16 / m56: invoices went
 * out at once from /invoices. The send sheet needs, over HTTP:
 *  - GET /invoices/:id/send-preview?channel&lang&issuedDate&dueDate — what
 *    the client gets if it is sent now, sending nothing;
 *  - POST /invoices/:id/email|text { language } — the Send goes out in the
 *    language the sheet picked (the email, the text and their links).
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { ConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore } from "@communication/domain/data/message-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [PaperworkModule] })
class TestApp {}

const PORT = 9727;
const base = `http://localhost:${PORT}`;
const PHONE = "+15125557270";

async function login(): Promise<{ sid: string; userId: string }> {
  await (await fetch(`${base}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: PHONE }),
  })).body?.cancel();
  const stored = await new OtpStore().get(PHONE);
  const v = await fetch(`${base}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: PHONE, code: stored!.code }),
  }).then((r) => r.json());
  // P-06: no outbound until the account has a real name
  await (await fetch(`${base}/me`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-session-id": v.sessionId,
    },
    body: JSON.stringify({ name: "Rosa Diaz" }),
  })).body?.cancel();
  const me = await new UserStore().findByPhone(PHONE);
  return { sid: v.sessionId, userId: me!.id };
}

/** what the comms log recorded going out for one invoice */
async function sentFor(userId: string, invoiceId: string) {
  const convs = await new ConversationStore().listByUser(userId);
  const all = (await Promise.all(
    convs.map((c) => new MessageStore().listByConversation(c.id)),
  )).flat();
  return all.filter((m) => m.paperworkId === invoiceId);
}

async function setup(auth: Record<string, string>) {
  const customer = await fetch(`${base}/customers`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Juan Perez",
      email: "juan@example.com",
      phoneNumber: "+15125551234",
    }),
  }).then((r) => r.json());
  const invoice = await fetch(`${base}/invoices`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: customer.id,
      jobName: "Fence repair",
      amount: 72500,
      status: "draft",
      dueDate: "2026-12-12",
    }),
  }).then((r) => r.json());
  return { customer, invoice };
}

Deno.test("REQ-727 (c4-M16) GET /invoices/:id/send-preview renders the email and the text in the picked language with the send's dates — and sends nothing", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const { sid, userId } = await login();
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const { invoice } = await setup(auth);

    const res = await fetch(
      `${base}/invoices/${invoice.id}/send-preview?channel=both&lang=es&issuedDate=2026-11-12&dueDate=2026-11-27`,
      { headers: auth },
    );
    assertEquals(res.status, 200);
    const p = await res.json();
    assertEquals(p.lang, "es");
    assert(
      p.email.subject.startsWith(`Factura ${invoice.number}`),
      p.email.subject,
    );
    assertStringIncludes(p.email.subject, "vence 27 de noviembre de 2026");
    assertEquals(p.email.to, "juan@example.com");
    assertStringIncludes(p.email.html, `/i/${invoice.id}?lang=es`);
    assertStringIncludes(p.sms.body, "tu factura está lista ($725)");
    assertStringIncludes(p.sms.body, "?lang=es");
    assertEquals(p.sms.to, "+15125551234");

    const sms = await fetch(
      `${base}/invoices/${invoice.id}/send-preview?channel=sms&lang=en`,
      { headers: auth },
    ).then((r) => r.json());
    assertEquals(sms.lang, "en");
    assertEquals(sms.email, undefined);
    assertStringIncludes(sms.sms.body, "your invoice is ready ($725)");

    // a malformed date is ignored, never rendered
    const odd = await fetch(
      `${base}/invoices/${invoice.id}/send-preview?channel=email&lang=en&dueDate=soon`,
      { headers: auth },
    ).then((r) => r.json());
    assert(!/soon|invalid/i.test(odd.email.subject), odd.email.subject);
    assertStringIncludes(odd.email.subject, "2026", "the stored due date");

    // nothing went out, nothing changed
    const after = await fetch(`${base}/invoices/${invoice.id}`, {
      headers: auth,
    }).then((r) => r.json());
    assertEquals(after.status, "draft");
    assertEquals(after.sentAt, undefined);
    assertEquals(after.dueDate, "2026-12-12");
    assertEquals((await sentFor(userId, invoice.id)).length, 0);

    const anon = await fetch(
      `${base}/invoices/${invoice.id}/send-preview?channel=both&lang=en`,
    );
    await anon.body?.cancel();
    assert(
      anon.status === 401 || anon.status === 403,
      `anon status ${anon.status}`,
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("REQ-727 (c4-M16) POST /invoices/:id/email and /text go out in the posted language — subject, body and links", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  Deno.env.delete("TWILIO_ACCOUNT_SID"); // dev mode: the text is logged, not sent
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const { sid, userId } = await login();
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const { invoice } = await setup(auth);

    const email = await fetch(`${base}/invoices/${invoice.id}/email`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ language: "es" }),
    }).then((r) => r.json());
    assertEquals(email.ok, true, JSON.stringify(email));
    assert(
      email.subject.startsWith(`Factura ${invoice.number}`),
      email.subject,
    );

    const text = await fetch(`${base}/invoices/${invoice.id}/text`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ language: "es" }),
    }).then((r) => r.json());
    assertEquals(text.ok, true, JSON.stringify(text));

    const out = await sentFor(userId, invoice.id);
    const mail = out.find((m) => m.channel === "email");
    const sms = out.find((m) => m.channel === "text");
    assert(mail, "the email was logged");
    assertStringIncludes(mail.htmlBody ?? "", `/i/${invoice.id}?lang=es`);
    assert(sms, "the text was logged");
    assertStringIncludes(sms.content, "tu factura está lista");
    assertStringIncludes(sms.content, "?lang=es");

    // an unknown language is ignored (the Settings default, as before)
    const odd = await fetch(`${base}/invoices/${invoice.id}/email`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ language: "fr" }),
    });
    assertEquals(odd.status, 200);
    assertEquals((await odd.json()).ok, true);
  } finally {
    await server.stop();
    await resetKv();
  }
});
