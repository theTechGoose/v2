/**
 * REQ-784 — Raphael: "And yes to a sent message outbox." Demo-loop cycle
 * dv1, issue d12. The outbox over HTTP:
 *
 *   GET /outbox       the signed-in account's customer messages, newest
 *                     first — the list carries no bodies
 *   GET /outbox/:id   one message with its content as sent
 *
 * Another account's entry is never opened; no session is a 401.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CommunicationModule } from "@communication/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore } from "@communication/domain/data/message-store/mod.ts";

@Module({ imports: [UsersModule, CommunicationModule] })
class TestApp {}

const PORT = 9784;
const base = `http://localhost:${PORT}`;

async function login(phone: string): Promise<{ sid: string; userId: string }> {
  await (await fetch(`${base}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return { sid: v.sessionId, userId: v.userId };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

Deno.test("REQ-784 d12: GET /outbox lists the caller's customer messages newest first without bodies; GET /outbox/:id opens one as sent; another account's is refused; no session is 401", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const a = await login("+15125557841");
    const b = await login("+15125557842");
    const log = new LogPaperworkMessage(
      new ConversationStore(),
      new MessageStore(),
    );
    const html =
      "<!doctype html><html><body><h1>Cotización Q-001</h1><p>Hola María</p></body></html>";
    await log.outbox({
      userId: a.userId,
      channel: "email",
      kind: "quote",
      language: "es",
      ok: true,
      customerId: "c-maria",
      customerName: "María López",
      to: "maria@example.com",
      docId: "q-1",
      docRef: "Q-001",
      subject: "Cotización Q-001 de Ortega Handyman Services",
      body: html,
    });
    await tick();
    await log.outbox({
      userId: a.userId,
      channel: "text",
      kind: "quote",
      language: "es",
      ok: false,
      reasonCode: "fictional",
      reason: "that's a reserved test number (555-01XX or area code 555)",
      customerId: "c-maria",
      customerName: "María López",
      to: "+15125550188",
      docId: "q-1",
      docRef: "Q-001",
      body: "Hola María, soy Luis…",
    });
    await tick();
    const theirs = await log.outbox({
      userId: b.userId,
      channel: "email",
      kind: "invoice",
      language: "en",
      ok: true,
      customerName: "Someone Else",
      to: "else@example.com",
      subject: "Invoice INV-001",
      body: "<p>private</p>",
    });
    assert(theirs, "B's entry was recorded");

    const res = await fetch(`${base}/outbox`, {
      headers: { "x-session-id": a.sid },
    });
    assertEquals(res.status, 200);
    const list = await res.json() as Array<Record<string, unknown>>;
    assertEquals(list.length, 2, JSON.stringify(list));
    assertEquals(list.map((e) => e.channel), ["text", "email"], "newest first");
    assertEquals(list[0].status, "not_sent");
    assertEquals(list[0].reasonCode, "fictional");
    assertEquals(list[1].status, "sent");
    assertEquals(list[1].language, "es");
    assertEquals(list[1].customerName, "María López");
    assertEquals(
      list[1].preview,
      "Cotización Q-001 de Ortega Handyman Services",
    );
    assertEquals(list.some((e) => "body" in e), false, "no bodies in the list");
    assertEquals(
      list.some((e) => e.to === "else@example.com"),
      false,
      "never another account's",
    );

    const opened = await fetch(`${base}/outbox/${list[1].id}`, {
      headers: { "x-session-id": a.sid },
    }).then((r) => r.json());
    assertEquals(opened.body, html, "the email exactly as sent");
    assertEquals(
      opened.subject,
      "Cotización Q-001 de Ortega Handyman Services",
    );
    const skipped = await fetch(`${base}/outbox/${list[0].id}`, {
      headers: { "x-session-id": a.sid },
    }).then((r) => r.json());
    assertEquals(
      skipped.body,
      "",
      "a text that didn't go has no content as sent",
    );

    const foreign = await fetch(`${base}/outbox/${theirs.id}`, {
      headers: { "x-session-id": a.sid },
    });
    const foreignBody = await foreign.text();
    assert(
      foreign.status === 403 || foreign.status === 404,
      `another account's entry: ${foreign.status}`,
    );
    assert(!foreignBody.includes("private"), foreignBody);

    const anon = await fetch(`${base}/outbox`);
    await anon.body?.cancel();
    assertEquals(anon.status, 401);
  } finally {
    await server.stop();
    await resetKv();
  }
});

/**
 * REQ-989 (LOOP-007 q1, q1-72) — "Customer's Mensajes tab shows none of the
 * emails sent to her". Her page has to ask for HER entries alone:
 * `GET /outbox?customerId=<id>` lists only the caller's entries for that
 * customer — never another customer's of the same account, never another
 * account's entry that happens to carry the same customer id.
 */
Deno.test("REQ-989 q1-72: GET /outbox?customerId= lists only that customer's entries of the caller's account", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const PORT2 = 9989;
  const base2 = `http://localhost:${PORT2}`;
  const server = await bootstrapServer(TestApp, {
    port: PORT2,
    swagger: false,
  });
  await server.listen();
  const login2 = async (phone: string) => {
    await (await fetch(`${base2}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
    })).body?.cancel();
    const stored = await new OtpStore().get(phone);
    const v = await fetch(`${base2}/auth/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
    }).then((r) => r.json());
    return { sid: v.sessionId as string, userId: v.userId as string };
  };
  try {
    const a = await login2("+15125559891");
    const b = await login2("+15125559892");
    const log = new LogPaperworkMessage(
      new ConversationStore(),
      new MessageStore(),
    );
    const entry = (
      userId: string,
      customerId: string,
      to: string,
      docRef: string,
    ) =>
      log.outbox({
        userId,
        channel: "email",
        kind: "invoice",
        language: "es",
        ok: true,
        customerId,
        customerName: customerId,
        to,
        docRef,
        subject: `Factura ${docRef}`,
        body: "<p>hola</p>",
      });
    await entry(a.userId, "c-maria", "maria@example.com", "INV-001");
    await tick();
    await entry(a.userId, "c-other", "other@example.com", "INV-002");
    await tick();
    await entry(a.userId, "c-maria", "maria@example.com", "INV-003");
    await tick();
    await entry(b.userId, "c-maria", "foreign@example.com", "INV-900");

    const res = await fetch(`${base2}/outbox?customerId=c-maria`, {
      headers: { "x-session-id": a.sid },
    });
    assertEquals(res.status, 200);
    const list = await res.json() as Array<Record<string, unknown>>;
    assertEquals(
      list.map((e) => e.docRef),
      ["INV-003", "INV-001"],
      `only María's entries, newest first: ${JSON.stringify(list)}`,
    );
    assertEquals(
      list.some((e) => e.to === "foreign@example.com"),
      false,
      "never another account's",
    );

    const none = await fetch(`${base2}/outbox?customerId=c-nobody`, {
      headers: { "x-session-id": a.sid },
    }).then((r) => r.json()) as unknown[];
    assertEquals(none.length, 0, "a customer with nothing sent lists nothing");

    const all = await fetch(`${base2}/outbox`, {
      headers: { "x-session-id": a.sid },
    }).then((r) => r.json()) as unknown[];
    assertEquals(all.length, 3, "without the filter the whole account's list stands");
  } finally {
    await server.stop();
    await resetKv();
  }
});
