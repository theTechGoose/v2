/**
 * REQ-563 (demo-loop cycle 4, issue m3) — the chat says the client signed.
 *
 * The demo: after the customer signed on /q, only the chat header changed;
 * the thread still ended on "Couldn't send / Text not delivered", and nothing
 * said who signed or that the deposit invoice went out ("Nothing tells me
 * what to do next"). RCA: the public accept route (PaperworkPublicController
 * POST /quotes/:id/accept) emits the bus event and runs the alert + signed
 * confirmation, and writes nothing to the quote's conversation — only the dev
 * "simulate" path (AcceptQuote via POST /conversations/:id/accept-quote) did.
 *
 * This drives the real composed app over HTTP: the owner's thread is bound to
 * a sent quote, the customer signs on /q with no session, and the owner's
 * GET /conversations/:id must end with a divider naming the signer, the quote
 * number and the deposit invoice the signature billed; the conversation row
 * carries the invoice so the list's chip and the header agree.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertMatch } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { shortDate } from "#documents/linked-view.ts";

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

interface Msg {
  role: string;
  kind: string;
  content: string;
  payload?: Record<string, unknown>;
}

async function signedThread(
  lang: "en" | "es",
  phone: string,
  paymentTerms: string,
) {
  const sid = await login(phone);
  const auth = { ...JSON_HEADERS, "x-session-id": sid };
  const me = await call("PUT", "/me", auth, { language: lang, name: "Rosa" });
  const userId = (me.id ?? me.user?.id) as string | undefined;
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
    terms: [{ stepId: "payment_terms", label: "Payment", value: paymentTerms }],
  });
  await call("PUT", `/quotes/${quote.id}`, auth, { status: "sent" });
  const owner = userId ?? (await call("GET", `/quotes/${quote.id}`, auth))
    .userId;
  // the owner's thread for this quote (the chat binds quoteId on lock)
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

  const fresh = await call("GET", `/quotes/${quote.id}`, auth);
  const invoices = (await call("GET", "/invoices", auth) as {
    id: string;
    number?: string;
    quoteId?: string;
    status?: string;
    installmentIndex?: number;
  }[]).filter((i) => i.quoteId === quote.id);
  const first = invoices.find((i) => (i.installmentIndex ?? 1) === 1);
  // the list first: opening the thread clears its unread badge
  const list = await call("GET", "/agents/conversations", auth);
  const thread = await call("GET", `/agents/conversations/${conv.id}`, auth);
  const messages = thread.messages as Msg[];
  const rows = (Array.isArray(list) ? list : list.conversations ?? []) as {
    id: string;
    invoiceStatus?: string;
    invoiceId?: string;
    hasUnreadEvent?: boolean;
  }[];
  return {
    quote: fresh,
    first,
    messages,
    row: rows.find((r) => r.id === conv.id),
  };
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

Deno.test("REQ-563 m3: a public signature appends ONE divider to the quote's thread naming the signer, the quote number and the deposit invoice it billed; the row carries the invoice", async () => {
  await withApp(async () => {
    const { quote, first, messages, row } = await signedThread(
      "en",
      "+15125557563",
      "50/50",
    );
    assert(first, "the signature billed a deposit invoice");
    assert(quote.number, "the quote has a number");
    const signed = messages.filter((m) =>
      m.kind === "phase_divider" && m.payload?.signed === true
    );
    assertEquals(signed.length, 1, JSON.stringify(messages));
    const d = signed[0];
    assertEquals(d.role, "system");
    assertEquals(d.payload?.phase, 4);
    assertEquals(d.payload?.quoteId, quote.id);
    assertEquals(d.payload?.invoiceId, first.id);
    assertEquals(d.payload?.invoiceStatus, "sent");
    assertEquals(
      d.content,
      `Linda Perez signed ${quote.number} · deposit ${first.number} $1,425.00 sent`,
    );
    assertEquals(d.payload?.label, d.content);
    // the list's chip reads the conversation's invoice — the header's words
    assertEquals(row?.invoiceStatus, "sent");
    assertEquals(row?.invoiceId, first.id);
    assertEquals(row?.hasUnreadEvent, true);
  });
});

Deno.test("REQ-563 m3: in Spanish, and with one invoice (Due Now) it is 'factura', not 'anticipo'", async () => {
  await withApp(async () => {
    const { quote, first, messages } = await signedThread(
      "es",
      "+15125557564",
      "Due Now",
    );
    assert(first);
    const d = messages.find((m) =>
      m.kind === "phase_divider" && m.payload?.signed === true
    );
    assert(d, JSON.stringify(messages));
    assertMatch(
      d.content,
      new RegExp(
        `^Linda Perez firmó ${quote.number} · factura ${first.number} \\$2,850\\.00 enviada$`,
      ),
    );
  });
});

/** REQ-697 (demo-loop cycle 5, m22): "Payment upon completion" bills
 *  nothing at signing — it schedules INV-001 and the owner is reminded to
 *  send it. The signing line says so ("scheduled, not sent — we'll remind
 *  you on … to send it (due …)") instead of a bare "signed", and the /q page
 *  gets the days to pay its payment term states. */
for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-697 m22 (${lang}): an 'upon completion' signature says which invoice is scheduled, when the owner is reminded and when it is due`, async () => {
    await withApp(async () => {
      const { quote, first, messages } = await signedThread(
        lang,
        lang === "en" ? "+15125557697" : "+15125557698",
        "Payment upon completion",
      );
      const inv = first as
        | {
          id: string;
          number?: string;
          status?: string;
          scheduledFor?: string;
          dueDate?: string;
        }
        | undefined;
      assert(inv, "the signature scheduled the completion invoice");
      assertEquals(inv.status, "scheduled");
      assert(inv.scheduledFor && inv.dueDate, JSON.stringify(inv));
      const d = messages.find((m) =>
        m.kind === "phase_divider" && m.payload?.signed === true
      );
      assert(d, JSON.stringify(messages));
      const date = shortDate(inv.scheduledFor, lang);
      const due = shortDate(inv.dueDate, lang);
      assertEquals(
        d.content,
        lang === "en"
          ? `Linda Perez signed ${quote.number} · ${inv.number} $2,850.00 is scheduled, not sent — we'll remind you on ${date} to send it (due ${due})`
          : `Linda Perez firmó ${quote.number} · ${inv.number} $2,850.00 está programada, sin enviar — te recordamos enviarla el ${date} (vence el ${due})`,
      );
      assertEquals(d.payload?.scheduledInvoiceId, inv.id);

      // the public agreement carries the business's days to pay (default 30)
      const pub = await fetch(`${base()}/quotes/${quote.id}/public`).then((
        r,
      ) => r.json());
      assertEquals(pub.contractor?.invoiceNetDays, 30);
    });
  });
}
