/**
 * REQ-403 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 2, issue m11: after a failed text the app listed
 * "Texted to +15125550177" in the quote panel and the signed page promised
 * "We'll text a confirmation to your phone."
 *
 * Integration over HTTP, app booted, SMS in dev mode (the fake that answers
 * ok for any number — exactly what the demo ran on): the customer signs on
 * the public page, then
 *   - the comms trail (`GET /messages`, the receipts strip's source) holds no
 *     "text" row to a fictional number,
 *   - `GET /quotes/:id/public` says which confirmation the page may promise
 *     (`confirmChannel`): "text" only for a textable number whose latest
 *     text did not fail, "email" when there is an email, "none" otherwise.
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
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import type { QuoteDelivery } from "#quote-flow/delivery.ts";

@Module({ imports: [UsersModule, PaperworkModule, CommunicationModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;

async function login(phone: string): Promise<string> {
  await (await fetch(`${base()}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base()}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function sentQuoteFor(
  sid: string,
  customer: { name: string; phoneNumber?: string; email?: string },
  lastDelivery?: QuoteDelivery,
): Promise<string> {
  const owner = (await new SessionStore().get(sid))!;
  const c = await new CustomerStore().create(owner.userId, customer);
  const q = await fetch(`${base()}/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-id": sid },
    body: JSON.stringify({ summary: "Fence", lineItems: [] }),
  }).then((r) => r.json());
  await new QuoteStore().update(q.id, owner.userId, {
    customerId: c.id,
    status: "sent",
    ...(lastDelivery ? { lastDelivery } : {}),
  });
  return q.id as string;
}

async function sign(id: string): Promise<void> {
  const res = await fetch(`${base()}/quotes/${id}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ana Torres" }),
  });
  assertEquals(res.status < 300, true, `accept → ${res.status}`);
  await res.body?.cancel();
}

const publicOf = (id: string) =>
  fetch(`${base()}/quotes/${id}/public`).then((r) => r.json());

Deno.test("REQ-403 (m11) a signed quote to a fictional number: no 'Texted to' trail row, and the page promises no text", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125554031");

    // the demo's number: exchange 555, line 01xx — fictional
    const fictional = await sentQuoteFor(sid, {
      name: "Ana Torres",
      phoneNumber: "+15125550177",
    }, {
      at: new Date().toISOString(),
      channel: "sms",
      smsFailureReason: "That number can't receive texts",
    });
    await sign(fictional);
    const trail = await fetch(`${base()}/messages`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json()) as {
      channel?: string;
      toAddress?: string;
      paperworkId?: string;
    }[];
    const texted = trail.filter((m) =>
      m.paperworkId === fictional && m.channel === "text"
    );
    assertEquals(
      texted.map((m) => m.toAddress),
      [],
      "a 'text' receipt was logged for a number that cannot get texts",
    );
    assertEquals((await publicOf(fictional)).confirmChannel, "none");

    // a real number whose latest text FAILED (Twilio said no) → no promise
    const failed = await sentQuoteFor(sid, {
      name: "Bo",
      phoneNumber: "+15125551234",
    }, {
      at: new Date().toISOString(),
      channel: "sms",
      smsFailureReason: "That number can't receive texts",
    });
    assertEquals((await publicOf(failed)).confirmChannel, "none");

    // a real number that was texted → the text promise stands, and the
    // completion text is logged once
    const real = await sentQuoteFor(sid, {
      name: "Cy",
      phoneNumber: "+15125551235",
    }, {
      at: new Date().toISOString(),
      channel: "sms",
      textedTo: "+15125551235",
    });
    await sign(real);
    assertEquals((await publicOf(real)).confirmChannel, "text");
    const after = await fetch(`${base()}/messages`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json()) as {
      channel?: string;
      toAddress?: string;
      paperworkId?: string;
    }[];
    assertEquals(
      after.filter((m) => m.paperworkId === real && m.channel === "text")
        .map((m) => m.toAddress),
      ["+15125551235"],
    );

    // an email on file → the email promise
    const mailed = await sentQuoteFor(sid, {
      name: "Di",
      email: "di@example.com",
      phoneNumber: "+15125550177",
    });
    assertEquals((await publicOf(mailed)).confirmChannel, "email");
  } finally {
    await server.stop();
    await resetKv();
  }
});
