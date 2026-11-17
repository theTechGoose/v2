/**
 * REQ-758 (demo-loop cycle 5v2, demo issue m20 re-opened) — a signature that
 * SCHEDULES the bill ("Payment upon completion") leaves the chat header and
 * the thread list saying "Signed · Invoice scheduled", the words /invoices
 * uses ("Scheduled"), not "Quote accepted".
 *
 * The verifier, live on demo-fixes after REQ-700: "after signing with INV-001
 * scheduled: chat header 'Q-001 · QUOTE ACCEPTED' and list chip 'Quote
 * accepted' (the 'Signed · Invoice scheduled' case never shows)".
 *
 * Why REQ-700 missed it: its test hand-built "what AcceptQuote leaves
 * behind" with conversation.invoiceId bound to the scheduled invoice. The real
 * AcceptQuote.recordSigned binds the conversation (and stamps the divider)
 * only when the signature SENT an invoice; for a scheduled one (REQ-697) it
 * wrote neither invoiceId nor invoiceStatus — so ListConversations and
 * LoadConversation had no invoice row to read and both fell back to "Quote
 * accepted".
 *
 * This drives the real composed app: the customer signs on /q with
 * "Payment upon completion", then the owner's list row and thread snapshot
 * must carry the scheduled invoice, and the header and the list chip must
 * both read "Signed · Invoice scheduled". Then the bill goes out on
 * /invoices and both follow the row to "Signed · Invoiced".
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { deriveChatHeader, threadChip } from "#quote-flow/chat-header.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;
const JSON_HEADERS = { "content-type": "application/json" };

async function login(phone: string): Promise<string> {
  await (await fetch(`${base()}/auth/send-otp`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base()}/auth/verify-otp`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

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

async function withApp(fn: () => Promise<void>) {
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

type Row = { id: string; invoiceStatus?: string; threadStatus?: string };

/** What the owner's list row and open thread say right now. */
async function words(auth: Record<string, string>, convId: string) {
  const list = await call("GET", "/agents/conversations", auth);
  const rows = (Array.isArray(list) ? list : list.conversations ?? []) as Row[];
  const row = rows.find((r) => r.id === convId);
  assert(row, JSON.stringify(rows));
  const snap = await call("GET", `/agents/conversations/${convId}`, auth);
  const header = deriveChatHeader({
    customerName: snap.customer?.name,
    quote: snap.quote,
    messages: snap.messages,
    invoiceStatus: snap.invoiceStatus,
  });
  return {
    listInvoiceStatus: row.invoiceStatus,
    snapshotInvoiceStatus: snap.invoiceStatus,
    header: header.statusKey,
    list: threadChip(
      row.threadStatus as Parameters<typeof threadChip>[0],
      row.invoiceStatus,
    )?.key,
  };
}

Deno.test("REQ-758 m20 (5v2): signed with INV-001 scheduled — header and list chip both say 'Signed · Invoice scheduled', then follow the row to 'Signed · Invoiced'", async () => {
  await withApp(async () => {
    const sid = await login("+15125557758");
    const auth = { ...JSON_HEADERS, "x-session-id": sid };
    await call("PUT", "/me", auth, { language: "en", name: "Rosa" });
    const customer = await call("POST", "/customers", auth, {
      name: "Linda Perez",
      email: "linda@blackhole.postmarkapp.com",
    });
    const quote = await call("POST", "/quotes", auth, {
      customerId: customer.id,
      summary: "Deck rebuild",
      jobName: "Deck rebuild",
      lineItems: [{
        description: "Deck rebuild",
        quantity: 1,
        unit: "job",
        price: 285000,
      }],
      estimatedTotal: 285000,
      terms: [{
        stepId: "payment_terms",
        label: "Payment",
        value: "Payment upon completion",
      }],
    });
    await call("PUT", `/quotes/${quote.id}`, auth, { status: "sent" });
    const owner = (await call("GET", `/quotes/${quote.id}`, auth)).userId;
    const convs = new AgentConversationStore();
    const created = await convs.create({
      userId: owner,
      customerId: customer.id,
      currentPhase: "terms",
    });
    const conv = await convs.update(created.id, { quoteId: quote.id });

    // the customer signs on /q (no session)
    const accepted = await call(
      "POST",
      `/quotes/${quote.id}/accept`,
      JSON_HEADERS,
      { name: "Linda Perez", signature: "data:image/png;base64,iVBORw0KGgo=" },
    );
    assertEquals(accepted.ok, true);

    const inv = (await call("GET", "/invoices", auth) as {
      id: string;
      quoteId?: string;
      status?: string;
    }[]).find((i) => i.quoteId === quote.id);
    assert(inv, "the signature scheduled the completion invoice");
    assertEquals(inv.status, "scheduled", "what /invoices shows");

    assertEquals(await words(auth, conv.id), {
      listInvoiceStatus: "scheduled",
      snapshotInvoiceStatus: "scheduled",
      header: "asstChat.header.signedScheduled",
      list: "asstChat.header.signedScheduled",
    });

    // the bill goes out on the paperwork side; both follow the invoice row
    await new InvoiceStore().update(inv.id, owner, { status: "sent" });
    assertEquals(await words(auth, conv.id), {
      listInvoiceStatus: "sent",
      snapshotInvoiceStatus: "sent",
      header: "asstChat.header.signedInvoiced",
      list: "asstChat.header.signedInvoiced",
    });
  });
});
