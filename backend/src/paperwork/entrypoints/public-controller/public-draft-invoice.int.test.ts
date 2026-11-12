/**
 * REQ-312 — Raphael, 2026-11-11: "fix every issue the demo found, loop until
 * there are none." Demo-loop cycle 1, issue m29: a draft invoice (INV-002
 * Borrador $600) was listed to the end customer on the signed /q page.
 *
 * Integration over HTTP, app booted: a signed quote with one issued invoice
 * (the accept billed it) and one DRAFT invoice the contractor has not sent.
 * The customer-facing projections — GET /quotes/:id/public `invoices` and
 * GET /invoices/:id/public `siblings` — carry only the issued invoice; the
 * draft stays on the contractor's own ledger (GET /invoices).
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

async function login(phone = "+15125553129"): Promise<string> {
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
  return v.sessionId;
}

Deno.test("REQ-312 (demo m29): a draft invoice on a signed quote is absent from the public quote and invoice pages, present on the contractor's ledger", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const q = await fetch(`${BASE}/quotes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        summary: "Fence repair",
        lineItems: [],
        status: "sent",
        estimatedTotal: 1_200_00,
        terms: [{ stepId: "payment_terms", value: "Due Now" }],
      }),
    }).then((r) => r.json());
    const signed = await fetch(`${BASE}/quotes/${q.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ana Pérez" }),
    }).then((r) => r.json());
    assertEquals(signed.ok, true);

    // the contractor starts a second invoice on the agreement and does NOT send it
    const draft = await fetch(`${BASE}/invoices`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        quoteId: q.id,
        status: "draft",
        amount: 600_00,
        override: true,
      }),
    }).then((r) => r.json());
    assertEquals(draft.status, "draft", JSON.stringify(draft));

    const ledger: Array<{ id: string; quoteId?: string; status?: string }> =
      await fetch(`${BASE}/invoices`, { headers: { "x-session-id": sid } })
        .then((r) => r.json());
    const onQuote = ledger.filter((i) => i.quoteId === q.id);
    assertEquals(onQuote.length, 2, "the contractor's ledger has both");
    const issued = onQuote.find((i) => i.status !== "draft")!;

    // the customer's /q page: only the issued invoice
    const pub = await fetch(`${BASE}/quotes/${q.id}/public`).then((r) =>
      r.json()
    );
    assertEquals(
      pub.invoices.map((i: { id: string; status?: string }) => [
        i.id,
        i.status,
      ]),
      [[issued.id, issued.status]],
      "the draft leaked to the public quote page",
    );

    // the customer's /i page for the issued invoice: no draft sibling
    const pubInv = await fetch(`${BASE}/invoices/${issued.id}/public`).then((
      r,
    ) => r.json());
    assertEquals(
      pubInv.siblings.map((s: { id: string }) => s.id),
      [issued.id],
      "the draft leaked to the public invoice page's siblings",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
