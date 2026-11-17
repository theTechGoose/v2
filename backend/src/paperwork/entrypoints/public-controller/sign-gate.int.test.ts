/**
 * REQ-460 — demo-loop cycle 3, issues M16 + M15 (+ B1's cause): the customer
 * link was signed while the quote was still being finished. "Lock it in"
 * showed the link, the owner opened it "as customer" and signed in person
 * while the terms wizard was still asking "When do you want to get paid?";
 * `POST /quotes/:id/accept` took it, and with no payment terms on the row the
 * signature billed the whole $14,500 as one invoice marked Sent.
 *
 * A quote is signable once it was put in front of the customer with its
 * payment terms settled: never sent → 409 `not_issued` (the in-person
 * override does not change that); the wizard's terms on it but no payment
 * terms yet → 409 `terms_incomplete`. The public payload says the same
 * (`signRefusal`) so the page shows no pad. A Send that reached nobody still
 * offered it (REQ-236 keeps it a draft; the REQ-310 link is the fallback), and
 * a quote written over the API with no wizard terms bills its total (REQ-240).
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import type { Quote } from "@paperwork/dto/quote.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;
const J = { "content-type": "application/json" };
const OVERRIDE = "?as=customer&confirm=1";

const START = { stepId: "start_date", label: "Start", value: "Next week" };
const WRAPS = { stepId: "wraps", label: "Time to complete", value: "2–3 days" };
const FIFTY = { stepId: "payment_terms", label: "Payment", value: "50 / 50" };

async function withServer(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
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

async function login(phone = "+15125554602") {
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
  const sid = v.sessionId as string;
  const owner = (await new SessionStore().get(sid))!;
  return { sid, userId: owner.userId };
}

/** A priced quote through the API, then the server-side writes that the
 *  chat's lock / wizard / send would make (`patch`). */
async function quoteWith(
  owner: { sid: string; userId: string },
  patch: Partial<Quote>,
): Promise<string> {
  const q = await fetch(`${base()}/quotes`, {
    method: "POST",
    headers: { ...J, "x-session-id": owner.sid },
    body: JSON.stringify({
      summary: "Roof replacement",
      lineItems: [{
        description: "Roof replacement",
        quantity: 1,
        unit: "job",
        price: 1_450_000,
      }],
      estimatedTotal: 1_450_000,
    }),
  }).then((r) => r.json());
  await new QuoteStore().update(q.id, owner.userId, patch);
  return q.id as string;
}

async function accept(
  id: string,
  headers: Record<string, string> = {},
  query = "",
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base()}/quotes/${id}/accept${query}`, {
    method: "POST",
    headers: { ...J, ...headers },
    body: JSON.stringify({ name: "Linda Ortiz", signature: "Linda Ortiz" }),
  });
  return { status: res.status, body: await res.json() };
}

const publicOf = (id: string, headers: Record<string, string> = {}) =>
  fetch(`${base()}/quotes/${id}/public`, { headers }).then((r) => r.json());

async function invoicesOf(sid: string, quoteId: string) {
  const all = await fetch(`${base()}/invoices`, {
    headers: { "x-session-id": sid },
  }).then((r) => r.json()) as { quoteId?: string; amount?: number }[];
  return all.filter((i) => i.quoteId === quoteId);
}

Deno.test("REQ-460 (demo-loop cycle 3, M16): a locked quote whose terms wizard is still asking is not signable — not by the customer, not in person by the owner; nothing is billed and the page is told", async () => {
  await withServer(async () => {
    const owner = await login();
    // "Lock it in", then the wizard answered start date + time to complete
    const id = await quoteWith(owner, {
      lockedAt: new Date().toISOString(),
      terms: [START, WRAPS],
    });

    const anon = await accept(id);
    assertEquals(
      { status: anon.status, reason: anon.body.reason },
      { status: 409, reason: "not_issued" },
      "the customer cannot sign a quote nobody sent",
    );

    // the demo's path: "Open as customer" → "Sign in person"
    const inPerson = await accept(
      id,
      { cookie: `pm_session=${owner.sid}` },
      OVERRIDE,
    );
    assertEquals(inPerson.status, 409);
    assertEquals(inPerson.body.reason, "not_issued");

    const q = await new QuoteStore().get(id);
    assertEquals(q.status, "draft", "nothing signed");
    assertEquals(q.acceptedAt, undefined);
    assertEquals(
      await invoicesOf(owner.sid, id),
      [],
      "no $14,500 invoice marked Sent",
    );

    const pub = await publicOf(id);
    assertEquals(pub.signRefusal, "not_issued", "the page shows no pad");
  });
});

Deno.test("REQ-460 (demo-loop cycle 3, M15): a sent quote with the wizard's terms but no payment terms is not signable (terms_incomplete); once the payment terms are on it, the signature bills them — a deposit, not the whole total", async () => {
  await withServer(async () => {
    const owner = await login("+15125554603");
    const id = await quoteWith(owner, {
      lockedAt: new Date().toISOString(),
      status: "sent",
      sentAt: new Date().toISOString(),
      terms: [START, WRAPS],
    });

    const early = await accept(id);
    assertEquals(
      { status: early.status, reason: early.body.reason },
      { status: 409, reason: "terms_incomplete" },
      "no signature before the payment terms are on the quote",
    );
    assertEquals((await new QuoteStore().get(id)).status, "sent");
    assertEquals(await invoicesOf(owner.sid, id), []);
    assertEquals((await publicOf(id)).signRefusal, "terms_incomplete");

    await new QuoteStore().update(id, owner.userId, {
      terms: [START, WRAPS, FIFTY],
    });
    assertEquals((await publicOf(id)).signRefusal, undefined);
    const signed = await accept(id);
    assertEquals(signed.status, 200, JSON.stringify(signed.body));
    const billed = (await invoicesOf(owner.sid, id))
      .map((i) => i.amount).sort();
    assertEquals(
      billed,
      [725_000, 725_000],
      "50 / 50 bills a deposit and a balance, not one $14,500 invoice",
    );
  });
});

Deno.test("REQ-460 (demo-loop cycle 3): still signable — a quote whose Send reached nobody (the link the contractor pastes, REQ-236/REQ-310) and a sent quote written over the API with no wizard terms (REQ-240)", async () => {
  await withServer(async () => {
    const owner = await login("+15125554604");
    const undelivered = await quoteWith(owner, {
      lockedAt: new Date().toISOString(),
      terms: [START, WRAPS, FIFTY],
      lastDelivery: {
        at: new Date().toISOString(),
        channel: "sms",
        smsFailureReason: "unreachable number",
      },
    });
    assertEquals((await publicOf(undelivered)).signRefusal, undefined);
    const a = await accept(undelivered);
    assertEquals(a.status, 200, JSON.stringify(a.body));

    const api = await quoteWith(owner, {
      status: "sent",
      sentAt: new Date().toISOString(),
    });
    assertEquals((await publicOf(api)).signRefusal, undefined);
    const b = await accept(api);
    assertEquals(b.status, 200, JSON.stringify(b.body));

    // a signed or declined quote keeps its own answers, never not_issued
    const again = await accept(api);
    assertEquals(again.body.reason, "already_accepted");
  });
});
