/**
 * REQ-1124 (LOOP-007 cycle 3, issue q3-52) — integration: after a chargeback
 * on an amount-only invoice, the customer's /i heading turns into "Services".
 *
 * The real backend (UsersModule + PaperworkModule, KV :memory:) is booted in
 * process and the invoices are made over its HTTP API exactly as the New
 * invoice form makes them; the real /i/[id] route then reads
 * GET /invoices/:id/public through globalThis.__backendFetch (the hook Deno
 * Deploy uses) and its server-rendered hero <h1> is read.
 *
 *   cd front-end && deno test -A --unstable-kv lib/chargeback-invoice-title.int.test.tsx
 */
import "npm:reflect-metadata@0.1.13";
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import { Module } from "jsr:@danet/core@2";
import { bootstrapServer } from "jsr:@mrg-keystone/danet@^1.0.2";
import { PaperworkModule } from "../../backend/src/paperwork/mod-root.ts";
import { UsersModule } from "../../backend/src/users/mod-root.ts";
import { OtpStore } from "../../backend/src/users/domain/data/otp-store/mod.ts";
import { resetKv } from "../../backend/src/core/data/kv/mod.ts";
import PublicInvoice from "../routes/i/[id].tsx";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

async function login(phone = "+15125551124"): Promise<string> {
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

/** the customer's (no session) server render of /i/:id → its hero <h1> */
async function heroTitle(id: string, lang: "en" | "es"): Promise<string> {
  (globalThis as { __backendFetch?: unknown }).__backendFetch = (
    req: Request,
  ) => {
    const u = new URL(req.url);
    const headers = new Headers(req.headers);
    headers.delete("x-session-id");
    return fetch(`${BASE}${u.pathname}${u.search}`, {
      method: req.method,
      headers,
    });
  };
  try {
    const page = PublicInvoice as unknown as (ctx: unknown) => Promise<VNode>;
    const vnode = await page({
      params: { id },
      req: new Request(`http://localhost/i/${id}?lang=${lang}`),
      state: {},
    });
    const doc = new DOMParser().parseFromString(
      renderToString(vnode),
      "text/html",
    )!;
    const article = doc.querySelector("[data-cy=invoice-doc]");
    assert(article, `the invoice page rendered (${doc.body?.textContent})`);
    const h1 = article.querySelector("h1");
    assert(h1, "the invoice hero <h1> rendered");
    return h1.textContent.trim();
  } finally {
    delete (globalThis as { __backendFetch?: unknown }).__backendFetch;
  }
}

Deno.test("REQ-1124 (q3-52) int: after a chargeback on an amount-only invoice the customer's /i heading is still 'Invoice INV-…' / 'Factura INV-…', never the made-up 'Services'; Undo leaves the invoice with no lines", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const post = (path: string, body: unknown) =>
      fetch(`${BASE}${path}`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
      }).then((r) => r.json());

    // The q3-52 tester's invoice: amount only, no job name, no lines.
    const inv = await post("/invoices", {
      status: "sent",
      amount: 1000_50,
      billTo: { name: "Ann Lee", email: "ann@example.com" },
    });
    assert(typeof inv.id === "string", JSON.stringify(inv));
    const number = inv.number as string;
    assert(number?.startsWith("INV-"), `numbered: ${number}`);
    assertEquals(
      await heroTitle(inv.id, "en"),
      `Invoice ${number}`,
      "before the chargeback the heading names the invoice",
    );

    const pay = await post("/payments", {
      invoiceId: inv.id,
      amount: 1000_50,
      method: "check",
      receivedAt: new Date().toISOString(),
    });
    assert(typeof pay.id === "string", JSON.stringify(pay));
    const cb = await post(`/payments/${pay.id}/chargeback`, {
      feeCents: 3500,
    });
    assert(cb.reversedAt, `charged back: ${JSON.stringify(cb)}`);

    const en = await heroTitle(inv.id, "en");
    assertEquals(
      en,
      `Invoice ${number}`,
      `after the chargeback the EN heading is "${en}"`,
    );
    const es = await heroTitle(inv.id, "es");
    assertEquals(
      es,
      `Factura ${number}`,
      `after the chargeback the ES heading is "${es}"`,
    );

    const undo = await post(`/payments/${pay.id}/chargeback/undo`, {});
    assert(!undo.reversedAt, `undone: ${JSON.stringify(undo)}`);
    const back = await fetch(`${BASE}/invoices/${inv.id}`, { headers: auth })
      .then((r) => r.json());
    assertEquals(back.amount, 1000_50, "undo: the fee is off");
    assertEquals(
      back.lineItems ?? [],
      [],
      "undo: the invoice is amount-only again — no leftover made-up line",
    );
    assertEquals(await heroTitle(inv.id, "en"), `Invoice ${number}`);
  } finally {
    await server.stop();
    await resetKv();
  }
});
