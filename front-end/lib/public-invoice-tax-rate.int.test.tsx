/**
 * REQ-1142 — LOOP-007 cycle 3, issue q3-72 [polish/BUG_POLISH], integration:
 * the public invoice /i and the invoice email print the tax rate the same way.
 *
 * The real backend (UsersModule + PaperworkModule, KV :memory:) is booted in
 * process. A customer and an invoice with 7% tax (taxRateBp 700) are made
 * over its HTTP API, the invoice is emailed in Spanish (POST
 * /invoices/:id/email), and the email's body is read back from GET /outbox.
 * The real /i/[id] route then reads GET /invoices/:id/public through
 * globalThis.__backendFetch (the hook Deno Deploy uses) and its tax row is
 * compared with the email's: QA saw /i "Impuesto (7.00%)" next to the
 * email's "Impuesto (7%)".
 *
 *   cd front-end && deno test -A --unstable-kv --no-check lib/public-invoice-tax-rate.int.test.tsx
 */
import "npm:reflect-metadata@0.1.13";
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
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

async function login(phone = "+15125557272"): Promise<string> {
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

/** the customer's (no session) server render of /i/:id → its tax row label */
async function publicTaxLabel(id: string, lang: "en" | "es"): Promise<string> {
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
    const word = lang === "es" ? "Impuesto" : "Tax";
    const span = [...article.querySelectorAll("span")].find((s) =>
      (s as Element).textContent.trim().startsWith(`${word} (`)
    );
    assert(span, `a "${word} (…)" row on /i (${article.textContent})`);
    return (span as Element).textContent.trim();
  } finally {
    delete (globalThis as { __backendFetch?: unknown }).__backendFetch;
  }
}

Deno.test("REQ-1142 (LOOP-007 q3, q3-72) int: an invoice with 7% tax reads 'Impuesto (7%)' on the server-rendered /i/:id exactly as its Spanish email does, never 'Impuesto (7.00%)'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const auth = { "content-type": "application/json", "x-session-id": sid };
    await (await fetch(`${BASE}/me`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ name: "Luis Ortega", language: "en" }),
    })).body?.cancel();
    const customer = await fetch(`${BASE}/customers`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Rosa Delgado",
        email: "rosa.delgado@blackhole.postmarkapp.com",
      }),
    }).then((r) => r.json());
    assert(typeof customer.id === "string", JSON.stringify(customer));
    const invoice = await fetch(`${BASE}/invoices`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        lineItems: [{
          description: "Reparación de techo",
          quantity: 1,
          unit: "job",
          price: 1000_00,
        }],
        subtotalCents: 1000_00,
        taxRateBp: 700,
        taxCents: 70_00,
        amount: 1070_00,
        billTo: {
          name: "Rosa Delgado",
          email: "rosa.delgado@blackhole.postmarkapp.com",
        },
      }),
    }).then((r) => r.json());
    assert(typeof invoice.id === "string", JSON.stringify(invoice));
    assertEquals(invoice.taxRateBp, 700, "the rate is stored as 700 bp");

    const sent = await fetch(`${BASE}/invoices/${invoice.id}/email`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ language: "es" }),
    });
    const sentText = await sent.text();
    const rows = await fetch(`${BASE}/outbox`, { headers: auth }).then((r) =>
      r.json()
    ) as Array<{ id: string; kind: string; channel: string }>;
    const row = rows.find((r) => r.kind === "invoice" && r.channel === "email");
    assert(
      row,
      `the invoice email is in the outbox (email → ${sent.status} ${sentText}; ${
        JSON.stringify(rows)
      })`,
    );
    const { body } = await fetch(`${BASE}/outbox/${row.id}`, { headers: auth })
      .then((r) => r.json()) as { body: string };
    const emailRate = body.match(/Impuesto \(([^)]*)\)/)?.[1];
    assertEquals(emailRate, "7%", "the Spanish email prints 'Impuesto (7%)'");

    const label = await publicTaxLabel(invoice.id, "es");
    assertEquals(
      label,
      `Impuesto (${emailRate})`,
      `/i must print the email's rate (got "${label}")`,
    );
    assert(!label.includes("7.00%"), `no padded '7.00%' on /i: "${label}"`);
  } finally {
    await server.stop();
    await resetKv();
  }
});
