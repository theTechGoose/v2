/**
 * REQ-1135 (LOOP-007 cycle 3, q3-60) — AMENDMENT of REQ-627: voiding an
 * invoice the customer was already sent tells her, when the owner asks to.
 *
 * Over HTTP, the QA path: the owner emails INV-001 to Rosa (one outbox row),
 * then voids it with `{notify: true}`. Rosa must get exactly one more email
 * in the outbox, for that invoice, saying it is cancelled and nothing is due —
 * and never the void reason or who voided it (REQ-627's decision). With
 * `{notify: false}` nothing goes out.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AnalyticsModule, CommunicationModule] })
class TestApp {}

const PORT = 41135;
const BASE = `http://localhost:${PORT}`;

// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any };
async function call(
  method: string,
  path: string,
  body?: unknown,
  sid?: string,
): Promise<Res> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(sid ? { "x-session-id": sid } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch { /* raw */ }
  return { status: r.status, body: parsed };
}

async function login(phone: string): Promise<string> {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const sid = v.body.sessionId as string;
  await call("PUT", "/me", { name: "Alexander Jerez", language: "en" }, sid);
  return sid;
}

async function withServer(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
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

type Row = {
  id: string;
  channel: string;
  docId?: string;
  to?: string;
  preview?: string;
  subject?: string;
};

/** A business, Rosa with an email, and an invoice EMAILED to her (sentAt). */
async function sentInvoice(sid: string) {
  const id = await call("PUT", "/profile/identity", {
    businessName: "A2Z Landscape LLC",
  }, sid);
  assert(id.status < 300, JSON.stringify(id.body));
  const rosa = await call("POST", "/customers", {
    name: "Rosa Diaz",
    email: "rosa.diaz@example.com",
  }, sid);
  assert(rosa.status < 300, JSON.stringify(rosa.body));
  const inv = await call("POST", "/invoices", {
    customerId: rosa.body.id,
    amount: 22_530,
    jobName: "Spring cleanup",
    status: "draft",
    dueDate: "2026-12-30",
  }, sid);
  assert(inv.status < 300, JSON.stringify(inv.body));
  const sent = await call("POST", `/invoices/${inv.body.id}/email`, {}, sid);
  assert(sent.status < 300, JSON.stringify(sent.body));
  const after = (await call("GET", `/invoices/${inv.body.id}`, undefined, sid))
    .body;
  assertEquals(after.status, "sent", "the invoice went out");
  return inv.body as { id: string; number: string };
}

const outbox = async (sid: string) =>
  (await call("GET", "/outbox", undefined, sid)).body as Row[];

Deno.test("REQ-1135 (LOOP-007 q3, q3-60): voiding a sent invoice with notify:true emails the customer exactly once that it is cancelled and nothing is due — no reason, no voider", async () => {
  await withServer(async () => {
    const sid = await login("+15125551135");
    const inv = await sentInvoice(sid);
    const before = await outbox(sid);
    assert(
      before.some((r) => r.channel === "email" && r.docId === inv.id),
      `the send itself is in the outbox: ${JSON.stringify(before)}`,
    );

    const v = await call("POST", `/invoices/${inv.id}/void`, {
      reason: "Owner typo on the total",
      notify: true,
    }, sid);
    assertEquals(v.status, 200, JSON.stringify(v.body));
    assertEquals(v.body.status, "void");

    const after = await outbox(sid);
    const added = after.filter((r) => !before.some((b) => b.id === r.id));
    assertEquals(
      added.length,
      1,
      `REQ-1135: the void tells Rosa — one new outbox row (outbox before ${before.length}, after ${after.length})`,
    );
    const row = added[0];
    assertEquals(row.channel, "email", "sent the way the invoice was sent");
    assertEquals(row.docId, inv.id, "about this invoice");
    const opened = (await call("GET", `/outbox/${row.id}`, undefined, sid))
      .body as { body: string; subject?: string; to?: string };
    const text = `${opened.subject ?? ""}\n${opened.body}`;
    assert(
      /cancel/i.test(text),
      `the message says the invoice is cancelled: ${text.slice(0, 400)}`,
    );
    assert(
      text.includes(inv.number),
      `names the invoice ${inv.number}`,
    );
    assert(
      /nothing is due|don.t pay|do not pay/i.test(text),
      `the message says nothing is due: ${text.slice(0, 400)}`,
    );
    assert(
      !text.includes("Owner typo on the total"),
      "REQ-627: never the void reason",
    );
    assert(
      !text.includes("Alexander Jerez"),
      "REQ-627: never who voided it",
    );
  });
});

Deno.test("REQ-1135 (LOOP-007 q3, q3-60): voiding a sent invoice with notify:false sends nothing", async () => {
  await withServer(async () => {
    const sid = await login("+15125552135");
    const inv = await sentInvoice(sid);
    const before = await outbox(sid);
    const v = await call("POST", `/invoices/${inv.id}/void`, {
      notify: false,
    }, sid);
    assertEquals(v.status, 200, JSON.stringify(v.body));
    assertEquals(
      (await outbox(sid)).length,
      before.length,
      "REQ-1135: notify:false — no outbox row",
    );
  });
});
