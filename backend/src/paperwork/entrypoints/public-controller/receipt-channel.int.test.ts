/**
 * REQ-523 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3, issue m16: pair 9's customer (Mrs Garcia,
 * 5125550142 — a fictional 555-01XX number) claimed a Zelle payment on /i and
 * read "We let your contractor know … we'll text you a receipt then." — after
 * the invoice's own text to that number had failed. The page promised a text
 * receipt unconditionally, and on confirm the receipt "text" was logged to
 * the comms trail whatever the SMS answered.
 *
 * Integration over HTTP, app booted, SMS in dev mode (what the demo ran on):
 *   - `GET /invoices/:id/public` says which channel the receipt can arrive on
 *     (`receiptChannel`): "email" when the customer has one, "text" only for
 *     a number that can take a text, "none" otherwise — REQ-403's rule;
 *   - after claim → confirm, the trail holds no "text" receipt to a number
 *     that cannot get texts, and exactly one to a real number.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
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

async function sentInvoiceFor(
  sid: string,
  customer: { name: string; phoneNumber?: string; email?: string },
): Promise<string> {
  const owner = (await new SessionStore().get(sid))!;
  const c = await new CustomerStore().create(owner.userId, customer);
  const res = await fetch(`${base()}/invoices`, {
    method: "POST",
    headers: { ...J, "x-session-id": sid },
    body: JSON.stringify({
      customerId: c.id,
      status: "sent",
      jobName: `Panel upgrade for ${customer.name}`,
      lineItems: [{ description: "Panel upgrade", quantity: 1, price: 450_00 }],
      amount: 450_00,
      dueDate: "2026-12-05",
    }),
  });
  const inv = await res.json();
  assertEquals(res.status < 300, true, `create → ${res.status}`);
  return inv.id as string;
}

const publicOf = (id: string) =>
  fetch(`${base()}/invoices/${id}/public`).then((r) => r.json());

/** the customer claims Zelle (anonymous), the owner confirms */
async function claimAndConfirm(sid: string, id: string): Promise<void> {
  const claim = await fetch(`${base()}/invoices/${id}/claim-payment`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ method: "zelle", claimedBy: "Mrs Garcia" }),
  });
  assertEquals(claim.status, 200, `claim → ${claim.status}`);
  await claim.body?.cancel();
  const confirm = await fetch(`${base()}/invoices/${id}/confirm-payment`, {
    method: "POST",
    headers: { ...J, "x-session-id": sid },
    body: "{}",
  });
  assertEquals(confirm.status < 300, true, `confirm → ${confirm.status}`);
  await confirm.body?.cancel();
}

async function textedReceipts(sid: string, id: string): Promise<string[]> {
  const trail = await fetch(`${base()}/messages`, {
    headers: { "x-session-id": sid },
  }).then((r) => r.json()) as {
    channel?: string;
    toAddress?: string;
    paperworkId?: string;
  }[];
  return trail
    .filter((m) => m.paperworkId === id && m.channel === "text")
    .map((m) => m.toAddress ?? "");
}

Deno.test("REQ-523 (m16) a claim on an invoice to a fictional number: the page promises no text receipt, and none is logged on confirm", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125552321");

    // pair 9's customer, no email: a fictional 555-01XX number
    const garcia = await sentInvoiceFor(sid, {
      name: "Mrs Garcia",
      phoneNumber: "5125550142",
    });
    assertEquals(
      (await publicOf(garcia)).receiptChannel,
      "none",
      "the page may not promise a text receipt to a number that cannot get one",
    );
    await claimAndConfirm(sid, garcia);
    assertEquals(
      await textedReceipts(sid, garcia),
      [],
      "a receipt 'text' was logged for a number that cannot get texts",
    );

    // a real number → the text promise stands, and the receipt is logged once
    const real = await sentInvoiceFor(sid, {
      name: "Cy Real",
      phoneNumber: "(512) 555-2322",
    });
    assertEquals((await publicOf(real)).receiptChannel, "text");
    await claimAndConfirm(sid, real);
    assertEquals(await textedReceipts(sid, real), ["+15125552322"]);

    // an email on file → the receipt is emailed, whatever the phone
    const mailed = await sentInvoiceFor(sid, {
      name: "Di Mail",
      email: "di@example.com",
      phoneNumber: "5125550142",
    });
    assertEquals((await publicOf(mailed)).receiptChannel, "email");

    // no contact at all → nothing can be promised
    const bare = await sentInvoiceFor(sid, { name: "No Contact" });
    assertEquals((await publicOf(bare)).receiptChannel, "none");
  } finally {
    await server.stop();
    await resetKv();
  }
});
