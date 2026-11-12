/**
 * REQ-388 (demo-loop cycle 2, run r561db6d4: M19 + M23) — on the booted app,
 * over HTTP, with the stub LLM (which only echoes "(stub) …"): these turns
 * run on the server's own paths, before any chat model.
 *
 *   M19 (pair 2): a Spanish contractor's quote for Ana López, "Payment upon
 *   completion", signed on the public page — which (REQ-316) schedules the
 *   invoice for the end of the job and sends nothing. "¿Cuánto me debe Ana
 *   López?" in a new chat answers $400 and when INV-001 goes out, in Spanish
 *   — never "El invoice ya se envió cuando firmó".
 *   M23 (pair 7): the two-part pricing question drafts no quote; a single
 *   pricing question offers the draft, and the offer's words draft it.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9388;
const BASE = `http://localhost:${PORT}`;

interface Msg {
  role: string;
  kind: string;
  content: string;
  payload?: Record<string, unknown>;
}

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

/** Signed in AND past the assistant's onboarding questions. */
async function signIn(
  language: "en" | "es",
  phone = "+15125557388",
): Promise<{ sid: string; userId: string }> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  await new UserStore().update(v.userId, {
    name: language === "es" ? "Jorge Ramirez" : "Priya Nair",
    email: "pro@test.dev",
    language,
  });
  await new BusinessIdentityStore().upsert(v.userId, {
    businessName: "Pro LLC",
    acceptedPaymentMethods: {
      zelle: { enabled: true, handle: "pro@test.dev" },
    },
  });
  await new BusinessAddressStore().upsert(v.userId, {
    city: "Austin",
    state: "TX",
    postal: "78701",
  });
  return { sid: v.sessionId, userId: v.userId };
}

function api(sid?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (sid) headers["x-session-id"] = sid;
  return async <T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert(res.ok, `${method} ${path} → ${res.status}`);
    return await res.json() as T;
  };
}

const texts = (msgs: Msg[]) =>
  msgs.filter((m) => m.role === "assistant" && m.kind === "text")
    .map((m) => m.content).join("\n");

type ChatRes = {
  conversation: { id: string; quoteId?: string };
  newMessages: Msg[];
};

Deno.test("REQ-388 M19 e2e: pair 2 — Ana signs a pay-on-completion quote on the public page; '¿Cuánto me debe Ana López?' answers $400 and when INV-001 goes out, in Spanish, never 'invoice'", async () => {
  await withServer(async () => {
    const me = await signIn("es");
    const call = api(me.sid);
    const ana = await call<{ id: string }>("POST", "/customers", {
      name: "Ana López",
      phoneNumber: "+15125550199",
    });
    const quote = await call<{ id: string }>("POST", "/quotes", {
      customerId: ana.id,
      summary: "Mantenimiento de jardín",
      jobName: "Mantenimiento de jardín",
      lineItems: [{
        description: "Mantenimiento de jardín, 4 semanas",
        quantity: 1,
        unit: "ea",
        price: 40_000,
      }],
      estimatedTotal: 40_000,
      estimatedCompletionDate: "2099-12-10",
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "Payment upon completion",
      }],
      status: "sent",
    });
    // REQ-460: the customer signs a SENT quote — POST /quotes makes a draft.
    await call("PUT", `/quotes/${quote.id}`, { status: "sent" });
    const accepted = await api()<{ ok: boolean }>(
      "POST",
      `/quotes/${quote.id}/accept`,
      { signature: "Ana López", name: "Ana López" },
    );
    assertEquals(accepted.ok, true);
    // REQ-316: signing scheduled the bill for the end of the job, sent nothing
    const billed = (await new InvoiceStore().listByUser(me.userId))
      .filter((i) => i.quoteId === quote.id);
    assertEquals(billed.map((i) => i.status), ["scheduled"]);
    const inv = billed[0];

    const res = await call<ChatRes>("POST", "/agents/chat", {
      content: "¿Cuánto me debe Ana López?",
    });
    const text = texts(res.newMessages);
    assert(!text.startsWith("(stub)"), `the chat model answered: ${text}`);
    // REQ-474 (cycle 3, M17): a scheduled bill is not owed yet
    assertStringIncludes(
      text,
      "Ana López todavía no te debe nada — $400 aún no se ha facturado",
    );
    assertStringIncludes(text, inv.number!);
    assertStringIncludes(text, "programada");
    assertStringIncludes(text, "10 dic");
    assert(!/invoice/i.test(text), `English 'invoice': ${text}`);
    assert(!/se envi[oó]/i.test(text), `claims it was sent: ${text}`);

    const followUp = await call<ChatRes>("POST", "/agents/chat", {
      conversationId: res.conversation.id,
      content: "No entiendo. ¿Cuánto dinero me debe y cuándo me va a pagar?",
    });
    const again = texts(followUp.newMessages);
    assert(!again.startsWith("(stub)"), `the chat model answered: ${again}`);
    assertStringIncludes(again, "$400");
    assertStringIncludes(again, "10 dic");

    // nothing billed, sent or changed by asking
    const after = (await new InvoiceStore().listByUser(me.userId))
      .filter((i) => i.quoteId === quote.id);
    assertEquals(after.map((i) => i.status), ["scheduled"]);
  });
});

Deno.test("REQ-474 M17 e2e: the demo's books over HTTP — Ana Pérez signs a $180 pay-on-completion quote (INV-001 scheduled), then a direct 'Bill a client' INV-002 $180 is sent; '¿Cuánto me debe Ana Pérez?' says $180 owed now and $180 not billed yet, never $360", async () => {
  await withServer(async () => {
    const me = await signIn("es", "+15125557474");
    const call = api(me.sid);
    const ana = await call<{ id: string }>("POST", "/customers", {
      name: "Ana Pérez",
      phoneNumber: "+15125550174",
    });
    const quote = await call<{ id: string }>("POST", "/quotes", {
      customerId: ana.id,
      summary: "Limpieza profunda",
      jobName: "Limpieza profunda",
      lineItems: [{
        description: "Limpieza profunda",
        quantity: 1,
        unit: "ea",
        price: 18_000,
      }],
      estimatedTotal: 18_000,
      estimatedCompletionDate: "2099-11-20",
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "Payment upon completion",
      }],
      status: "sent",
    });
    const accepted = await api()<{ ok: boolean }>(
      "POST",
      `/quotes/${quote.id}/accept`,
      { signature: "Ana Pérez", name: "Ana Pérez" },
    );
    assertEquals(accepted.ok, true);
    // the standalone New invoice: no quoteId
    await call("POST", "/invoices", {
      customerId: ana.id,
      amount: 18_000,
      status: "sent",
      issuedDate: "2026-11-12",
      dueDate: "2099-12-12",
    });
    const mine = await new InvoiceStore().listByUser(me.userId);
    assertEquals(mine.map((i) => i.status).sort(), ["scheduled", "sent"]);

    const res = await call<ChatRes>("POST", "/agents/chat", {
      content: "¿Cuánto me debe Ana Pérez?",
    });
    const text = texts(res.newMessages);
    assert(!text.startsWith("(stub)"), `the chat model answered: ${text}`);
    assertStringIncludes(
      text,
      "Ana Pérez te debe $180 ahora; $180 más aún no se ha facturado.",
    );
    assert(!text.includes("$360"), text);
  });
});

Deno.test("REQ-388 M23 e2e: pair 7's two-part pricing question drafts no quote; a one-job question offers the draft and 'Draft a quote at $X' writes it", async () => {
  await withServer(async () => {
    const me = await signIn("en");
    const call = api(me.sid);

    const pair7 = await call<ChatRes>("POST", "/agents/chat", {
      content:
        "what should i charge to move a shower drain 18 inches on a slab foundation in austin? explain how you got the number, and also cuánto cobro por piso radiante en un baño de 8x10?",
    });
    assertEquals(
      pair7.newMessages.filter((m) => m.kind === "action_card").length,
      0,
      "a question became a draft quote",
    );
    assertEquals((await new QuoteStore().listByUser(me.userId)).length, 0);
    assertEquals(pair7.conversation.quoteId, undefined);

    const asked = await call<ChatRes>("POST", "/agents/chat", {
      content: "how much do i charge for panel swap 200a",
    });
    const text = texts(asked.newMessages);
    assert(!text.startsWith("(stub)"), `the chat model answered: ${text}`);
    assertStringIncludes(text, "Market: $");
    assertEquals((await new QuoteStore().listByUser(me.userId)).length, 0);
    const offer = asked.newMessages.find((m) =>
      m.role === "assistant" && m.kind === "text"
    )?.payload?.draftOffer as { amountCents: number; title: string };
    assert(offer, "no draft offer on the pricing answer");
    assertEquals(offer.title, "Panel swap 200a");

    const dollars = `$${(offer.amountCents / 100).toLocaleString("en-US")}`;
    const drafted = await call<ChatRes>("POST", "/agents/chat", {
      conversationId: asked.conversation.id,
      content: `Draft a quote at ${dollars}`,
    });
    const card = drafted.newMessages.find((m) => m.kind === "action_card");
    assert(card, "no draft card");
    const quotes = await new QuoteStore().listByUser(me.userId);
    assertEquals(quotes.length, 1);
    assertEquals(quotes[0].estimatedTotal, offer.amountCents);
    assertEquals(quotes[0].lineItems[0].description, "Panel swap 200a");
    assertEquals(drafted.conversation.quoteId, quotes[0].id);
  });
});
