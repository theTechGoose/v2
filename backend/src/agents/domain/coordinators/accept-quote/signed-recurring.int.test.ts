/**
 * REQ-699 (demo-loop cycle 5, M20) — after María signed pair 2's monthly
 * quote, Jorge asked "¿y ahora cómo le cobro? ¿la factura sale sola?"
 * (fleet-1 stdout:425). The signed quote's divider in the owner's chat now
 * says what bills it and where: "María López firmó Q-001 · Mensual · $180/mes
 * — se cobra desde Campo → Suscripciones".
 *
 * The real composed app over HTTP — the agents' chat and Field together, as
 * backend/bootstrap/mod.ts boots them — the customer signing on /q.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { FieldModule } from "@field/mod-root.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { AcceptQuote } from "./mod.ts";

@Module({ imports: [AgentsModule, FieldModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;
const J = { "content-type": "application/json" };

async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  const r = await fetch(`${base()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json)}`);
  }
  return json;
}

Deno.test("REQ-699 M20: a signed monthly quote's divider says it bills 'Mensual · $180/mes' from Campo → Suscripciones — no invoice on the row", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const phone = "+15125556991";
    await (await fetch(`${base()}/auth/send-otp`, {
      method: "POST",
      headers: J,
      body: JSON.stringify({ phoneNumber: phone }),
    })).body?.cancel();
    const code = (await new OtpStore().get(phone))!.code;
    const v = await call("POST", "/auth/verify-otp", J, {
      phoneNumber: phone,
      code,
    });
    const auth = { ...J, "x-session-id": v.sessionId as string };
    await call("PUT", "/me", auth, { language: "es", name: "Jorge Ramirez" });
    const maria = await call("POST", "/customers", auth, {
      name: "María López",
      email: "maria@blackhole.postmarkapp.com",
    });
    const quote = await call("POST", "/quotes", auth, {
      customerId: maria.id,
      summary: "Corte de césped y poda de setos",
      jobName: "Corte de césped",
      serviceAddress: "845 Palm Ave, Orlando, FL 32803",
      lineItems: [{
        description: "Corte de césped y poda de setos (4 visitas al mes)",
        quantity: 1,
        unit: "month",
        price: 18_000,
      }],
      estimatedTotal: 18_000,
      terms: [
        { stepId: "start_date", label: "Start", value: "Next week" },
        {
          stepId: "payment_terms",
          label: "Payment",
          value: "Monthly · $180/mo",
        },
      ],
    });
    await call("PUT", `/quotes/${quote.id}`, auth, { status: "sent" });
    const convs = new AgentConversationStore();
    const created = await convs.create({
      userId: quote.userId,
      customerId: maria.id,
      currentPhase: "terms",
    });
    const conv = await convs.update(created.id, { quoteId: quote.id });

    const accepted = await call("POST", `/quotes/${quote.id}/accept`, J, {
      name: "María López",
    });
    assertEquals(accepted.ok, true);

    const thread = await call("GET", `/agents/conversations/${conv.id}`, auth);
    const d = (thread.messages as {
      kind: string;
      content: string;
      payload?: Record<string, unknown>;
    }[]).find((m) => m.kind === "phase_divider" && m.payload?.signed === true);
    assert(d, JSON.stringify(thread.messages));
    assertEquals(
      d.content,
      `María López firmó ${quote.number} · Mensual · $180/mes — se cobra desde Campo → Suscripciones`,
    );
    assertEquals(d.payload?.invoiceId, undefined, "no one-off invoice");
    const subs = await call("GET", "/field/subscriptions", auth);
    assertEquals(subs.map((s: { quoteId: string }) => s.quoteId), [quote.id]);
  } finally {
    await server.stop();
    await resetKv();
  }
});

// REQ-699: the divider names Field's billing only when the signature made
// that subscription. A recurring quote that billed neither (no customer for
// Field, and the deal already invoiced) reads the plain "signed" line.
Deno.test("REQ-699 recordSigned: 'billed from Field → Subscriptions' only when the signature made the subscription", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const convs = new AgentConversationStore();
    const messages = new AgentMessageStore();
    const quotes = new QuoteStore();
    const flow = new AcceptQuote(
      convs,
      messages,
      quotes,
      new UserStore(),
      new EventBus(),
    );
    const divider = async (subscriptionId?: string) => {
      const quote = await quotes.create("u-699", {
        summary: "Corte de césped",
        lineItems: [],
        estimatedTotal: 18_000,
        terms: [{
          stepId: "payment_terms",
          label: "Payment",
          value: "Monthly · $180/mo",
        }],
        status: "accepted",
        acceptedName: "María López",
      });
      const c = await convs.create({ userId: "u-699", currentPhase: "terms" });
      await convs.update(c.id, { quoteId: quote.id });
      const [d] = await flow.recordSigned({
        userId: "u-699",
        quoteId: quote.id,
        ...(subscriptionId ? { subscriptionId } : {}),
      });
      return { content: d.content, number: quote.number };
    };
    const made = await divider("sub-1");
    assertEquals(
      made.content,
      `María López signed ${made.number} · Monthly · $180/mo — billed from Field → Subscriptions`,
    );
    const none = await divider();
    assertEquals(none.content, `María López signed ${none.number}`);
  } finally {
    await resetKv();
  }
});
