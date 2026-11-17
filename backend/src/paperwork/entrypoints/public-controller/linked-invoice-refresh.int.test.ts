/**
 * REQ-493 (demo-loop cycle 3, issue m7; pair 9) — after the deposit was
 * confirmed paid, the owner's open /q page still read "Siguiente: paga los
 * $450.00 pendientes →" and "INV-001 Enviada · Saldo $450.00"; a fresh load
 * was right. /q re-reads `GET /quotes/:id/public?refresh=1` every 10 s
 * (REQ-396) but swapped the fresh projection in only when the QUOTE's own
 * view moved — and a payment moves none of it. This drives the real app over
 * HTTP and hands the two projections the page holds (before / after the
 * owner's confirm) to the page's own decision, `publicQuoteMoved`.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { deriveQuoteView } from "#quote-flow/public-doc-state.ts";
import { publicQuoteMoved } from "../../../../../front-end/lib/live-doc-refresh.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;
const JSON_HEADERS = { "content-type": "application/json" };

async function login(phone = "+15125558493"): Promise<string> {
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

interface Linked {
  id: string;
  status?: string;
  paidCents?: number;
  balanceCents?: number;
}

Deno.test("REQ-493 m7 (pair 9): the open /q page's re-read sees the deposit paid — publicQuoteMoved(before, after) is true while the quote's own view did not move", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const auth = { ...JSON_HEADERS, "x-session-id": sid };
    const customer = await call("POST", "/customers", auth, {
      name: "Maria Lopez",
      email: "maria@blackhole.postmarkapp.com",
    });
    const quote = await call("POST", "/quotes", auth, {
      customerId: customer.id,
      summary: "Cedar fence",
      jobName: "Cedar fence",
      lineItems: [{
        description: "Cedar fence",
        quantity: 1,
        unit: "job",
        price: 45000,
      }],
      estimatedTotal: 45000,
      terms: [{ stepId: "payment_terms", label: "Payment", value: "Due Now" }],
      status: "sent",
    });
    // REQ-460 (merged on demo-fixes): POST /quotes makes a draft; the
    // customer signs a SENT quote.
    await call("PUT", `/quotes/${quote.id}`, auth, { status: "sent" });
    const accepted = await call(
      "POST",
      `/quotes/${quote.id}/accept`,
      JSON_HEADERS,
      { name: "Maria Lopez", signature: "data:image/png;base64,iVBORw0KGgo=" },
    );
    assertEquals(accepted.ok, true);

    // what the owner's open /q tab holds: signed, the deposit still due
    const poll = () => call("GET", `/quotes/${quote.id}/public?refresh=1`, {});
    const shown = await poll();
    const due = (shown.invoices as Linked[] | undefined)?.[0];
    assert(due, `the signed /q lists the deposit: ${JSON.stringify(shown)}`);
    assert((due.balanceCents ?? 0) > 0, "the deposit is still due");

    // the customer claims it, the owner confirms it (another tab)
    const claim = await call(
      "POST",
      `/invoices/${due.id}/claim-payment`,
      JSON_HEADERS,
      { method: "zelle" },
    );
    assertEquals(claim.ok, true);
    const confirmed = await call(
      "POST",
      `/invoices/${due.id}/confirm-payment`,
      auth,
    );
    assertEquals(confirmed.ok, true);

    const fresh = await poll();
    const paid = (fresh.invoices as Linked[]).find((i) => i.id === due.id);
    assertEquals(paid?.status, "paid", "a fresh read has the deposit paid");
    assertEquals(paid?.balanceCents, 0);
    assertEquals(
      deriveQuoteView(fresh).mode,
      deriveQuoteView(shown).mode,
      "the quote's own view did not move — a payment is not a signature",
    );
    assertEquals(fresh.version, shown.version);
    assertEquals(
      publicQuoteMoved(shown, fresh),
      true,
      "the open /q page swaps in the paid projection on its next re-read",
    );
    assertEquals(
      publicQuoteMoved(fresh, await poll()),
      false,
      "and then holds still",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
