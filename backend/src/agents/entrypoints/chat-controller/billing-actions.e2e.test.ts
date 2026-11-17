/**
 * REQ-583 (demo-loop cycle 4, run r857a9d67, M2) — on the booted app, over
 * HTTP, with the stub LLM (which only echoes "(stub) …"): the assistant shows
 * a scheduled invoice with Send now, sends it when told to, and records the
 * payment it is told about. In the demo these ended in "I can't send the
 * invoice directly…" (pair 3), "No puedo enviar la factura ahora…" (pair 9)
 * and an ignored "…paid the deposit $1,425 by Zelle" (pair 1).
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
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9583;
const BASE = `http://localhost:${PORT}`;

interface Msg {
  role: string;
  kind: string;
  content: string;
  payload?: Record<string, unknown>;
}
type ChatRes = {
  conversation: { id: string; quoteId?: string };
  newMessages: Msg[];
};

async function withServer(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
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

async function signIn(phone: string): Promise<{ sid: string; userId: string }> {
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
    name: "Deb Kowalski",
    email: "deb@test.dev",
    language: "en",
  });
  await new BusinessIdentityStore().upsert(v.userId, {
    businessName: "Deb Cleans",
    acceptedPaymentMethods: {
      zelle: { enabled: true, handle: "deb@test.dev" },
    },
  });
  await new BusinessAddressStore().upsert(v.userId, {
    city: "Austin",
    state: "TX",
    postal: "78704",
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

Deno.test("REQ-583 M2 e2e: pair 3 over HTTP — a signed pay-on-completion job; 'Invoice Maria Lopez for the deep clean' shows INV-001 with Send now, 'send it to her now please' sends it, 'Maria paid $320 by Zelle today' records it", async () => {
  await withServer(async () => {
    const me = await signIn("+15127775830");
    const call = api(me.sid);
    const maria = await call<{ id: string }>("POST", "/customers", {
      name: "Maria Lopez",
      email: "maria@example.com",
    });
    const quote = await call<{ id: string }>("POST", "/quotes", {
      customerId: maria.id,
      summary: "3-bedroom 2-bath Cleaning",
      jobName: "3-bedroom 2-bath Cleaning",
      lineItems: [{
        description: "Deep clean, 4 hours",
        quantity: 1,
        unit: "ea",
        price: 32_000,
      }],
      estimatedTotal: 32_000,
      estimatedCompletionDate: "2099-11-19",
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "Payment upon completion",
      }],
      status: "sent",
    });
    await call("PUT", `/quotes/${quote.id}`, { status: "sent" });
    const accepted = await api()<{ ok: boolean }>(
      "POST",
      `/quotes/${quote.id}/accept`,
      { signature: "Maria Lopez", name: "Maria Lopez" },
    );
    assertEquals(accepted.ok, true);
    const [inv] = (await new InvoiceStore().listByUser(me.userId))
      .filter((i) => i.quoteId === quote.id);
    assertEquals(inv.status, "scheduled");

    // 1. the ask: where the bill stands, and the scheduled invoice to press
    const asked = await call<ChatRes>("POST", "/agents/chat", {
      content: "Invoice Maria Lopez for the deep clean",
    });
    const said = texts(asked.newMessages);
    assert(!said.startsWith("(stub)"), `the chat model answered: ${said}`);
    assertEquals(asked.conversation.quoteId, quote.id);
    const offer = asked.newMessages.find((m) =>
      m.kind === "action_card" && m.payload?.invoiceId === inv.id
    );
    assertEquals(offer?.payload?.offerSend, true, said);

    // 2. "send it to her now please" sends INV-001
    const sent = await call<ChatRes>("POST", "/agents/chat", {
      conversationId: asked.conversation.id,
      content: "send it to her now please",
    });
    const sentSaid = texts(sent.newMessages);
    assert(
      !sentSaid.startsWith("(stub)"),
      `the chat model answered: ${sentSaid}`,
    );
    assertStringIncludes(sentSaid, inv.number!);
    const out = await call<{ status: string }>("GET", `/invoices/${inv.id}`);
    assertEquals(out.status, "sent", sentSaid);

    // 3. "Maria paid $320 by Zelle today" records it
    const paid = await call<ChatRes>("POST", "/agents/chat", {
      conversationId: asked.conversation.id,
      content: "Maria paid $320 by Zelle today",
    });
    const paidSaid = texts(paid.newMessages);
    assert(
      !paidSaid.startsWith("(stub)"),
      `the chat model answered: ${paidSaid}`,
    );
    assertStringIncludes(paidSaid, "$320");
    assertStringIncludes(paidSaid, "Zelle");
    const after = await call<{ status: string }>("GET", `/invoices/${inv.id}`);
    assertEquals(after.status, "paid", paidSaid);
    const rows = await call<{ amount: number; method: string }[]>(
      "GET",
      `/payments?invoiceId=${inv.id}`,
    );
    assertEquals(rows.map((p) => [p.amount, p.method]), [[32_000, "zelle"]]);
  });
});
