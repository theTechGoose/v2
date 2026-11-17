/**
 * REQ-700 (demo-loop cycle 5, demo issue m20) — the chat header and the
 * conversation list name the bill a signature created from the LIVE invoice
 * row, not from snapshots.
 *
 * The demo (pairs 2 and 9): the signature scheduled the completion invoice;
 * the header kept "Cotización aceptada" (the signing divider's frozen
 * 'scheduled' fell through threadChip), the list said "Firmada · Facturada"
 * from conversation.invoiceStatus — which only assistant coordinators write —
 * and still said it after the payment was confirmed on /invoices.
 *
 * Here the invoice row moves the way the paperwork side moves it (no agents
 * coordinator runs, conversation.invoiceStatus stays stale), and after every
 * step the list row (ListConversations) and the snapshot the chat loads
 * (LoadConversation) carry the row's status, and the header and the list
 * chip read the same words.
 */
import { assertEquals } from "#std/assert";
import { deriveChatHeader, threadChip } from "#quote-flow/chat-header.ts";
import { ListConversations } from "./mod.ts";
import { LoadConversation } from "@agents/domain/coordinators/load-conversation/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const USER = "u-700";

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  return {
    conversations,
    messages,
    quotes,
    invoices,
    customers,
    load: new LoadConversation(
      conversations,
      messages,
      quotes,
      customers,
      invoices,
    ),
    list: new ListConversations(conversations, customers, quotes, invoices),
  };
}

async function withKv(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    await fn();
  } finally {
    await resetKv();
  }
}

/** A thread whose quote the customer signed, and whose signature scheduled
 *  the completion invoice — what AcceptQuote leaves behind. */
async function signedThread(s: ReturnType<typeof fresh>) {
  const customer = await s.customers.create(USER, { name: "Linda Park" });
  const quote = await s.quotes.create(USER, {
    summary: "Fence install",
    jobName: "Fence install",
    customerId: customer.id,
    lineItems: [{
      description: "Fence",
      quantity: 1,
      unit: "ea",
      price: 480_000,
    }],
    estimatedTotal: 480_000,
    status: "draft",
  });
  await s.quotes.update(quote.id, USER, {
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
  const invoice = await s.invoices.create(
    USER,
    {
      customerId: customer.id,
      quoteId: quote.id,
      lineItems: [{
        description: "Fence",
        quantity: 1,
        unit: "ea",
        price: 480_000,
      }],
      status: "scheduled",
    } as Parameters<InvoiceStore["create"]>[1],
  );
  const conv = await s.conversations.create({
    userId: USER,
    currentPhase: "quote",
    quoteId: quote.id,
    customerId: customer.id,
  });
  await s.messages.append({
    conversationId: conv.id,
    role: "system",
    kind: "phase_divider",
    content: "Linda Park signed Q-001",
    payload: {
      phase: 4,
      label: "Linda Park signed Q-001",
      quoteId: quote.id,
      signed: true,
      invoiceId: invoice.id,
      invoiceStatus: "scheduled",
    },
  });
  await s.conversations.update(conv.id, {
    quoteStatus: "accepted",
    invoiceId: invoice.id,
    invoiceStatus: "scheduled",
  });
  return { conv, invoice };
}

/** The header's words (the snapshot the chat loads) and the list chip's. */
async function words(s: ReturnType<typeof fresh>, convId: string) {
  const snap = await s.load.run({ userId: USER, conversationId: convId });
  const header = deriveChatHeader({
    customerName: snap.customer?.name,
    quote: snap.quote as Parameters<typeof deriveChatHeader>[0]["quote"],
    messages: snap.messages,
    invoiceStatus: snap.invoiceStatus,
  });
  const row = (await s.list.run({ userId: USER })).find((r) =>
    r.id === convId
  )!;
  return {
    snapshotInvoiceStatus: snap.invoiceStatus,
    listInvoiceStatus: row.invoiceStatus,
    header: header.statusKey,
    list: threadChip(row.threadStatus, row.invoiceStatus)?.key,
  };
}

Deno.test("REQ-700 m20 a signature that scheduled the bill: header and list both say 'Signed · Invoice scheduled'", async () => {
  await withKv(async () => {
    const s = fresh();
    const { conv } = await signedThread(s);
    assertEquals(await words(s, conv.id), {
      snapshotInvoiceStatus: "scheduled",
      listInvoiceStatus: "scheduled",
      header: "asstChat.header.signedScheduled",
      list: "asstChat.header.signedScheduled",
    });
  });
});

Deno.test("REQ-700 m20 the bill sent, then paid, on the paperwork side: header and list follow the invoice row, not conversation.invoiceStatus", async () => {
  await withKv(async () => {
    const s = fresh();
    const { conv, invoice } = await signedThread(s);

    // "Enviar ahora" on /invoices — the paperwork side writes the row only.
    await s.invoices.update(invoice.id, USER, { status: "sent" });
    assertEquals(await words(s, conv.id), {
      snapshotInvoiceStatus: "sent",
      listInvoiceStatus: "sent",
      header: "asstChat.header.signedInvoiced",
      list: "asstChat.header.signedInvoiced",
    });

    // The payment confirmed on /invoices.
    await s.invoices.update(invoice.id, USER, {
      status: "paid",
      paidAt: new Date().toISOString(),
    });
    assertEquals(await words(s, conv.id), {
      snapshotInvoiceStatus: "paid",
      listInvoiceStatus: "paid",
      header: "status.paid",
      list: "status.paid",
    });
    assertEquals(
      (await s.conversations.get(conv.id)).invoiceStatus,
      "scheduled",
      "the stored conversation.invoiceStatus is stale — neither reader may use it",
    );
  });
});

Deno.test("REQ-700 m20 a deleted bill: the list and the snapshot carry no invoice status, and the header does not fall back to the divider's 'scheduled'", async () => {
  await withKv(async () => {
    const s = fresh();
    const { conv, invoice } = await signedThread(s);
    await s.invoices.delete(invoice.id, USER);
    const w = await words(s, conv.id);
    assertEquals(w.listInvoiceStatus, undefined);
    assertEquals(w.snapshotInvoiceStatus, null);
    assertEquals(w.header, "asstChat.header.quoteAccepted");
    assertEquals(w.header, w.list);
  });
});
