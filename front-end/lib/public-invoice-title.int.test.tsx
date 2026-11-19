/**
 * REQ-984 (LOOP-007 cycle 1, issue q1-60) — integration: the public invoice
 * heading of an amount-only invoice is the placeholder "Project".
 *
 * The real backend (UsersModule + PaperworkModule, KV :memory:) is booted in
 * process and the invoices are made over its HTTP API exactly as the New
 * invoice form makes them; the real /i/[id] route then reads
 * GET /invoices/:id/public through globalThis.__backendFetch (the hook Deno
 * Deploy uses) and its server-rendered hero <h1> is read.
 *
 *   cd front-end && deno test -A --unstable-kv lib/public-invoice-title.int.test.tsx
 */
import "npm:reflect-metadata@0.1.13";
import { assert } from "@std/assert";
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

async function login(phone = "+15125556060"): Promise<string> {
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

Deno.test("REQ-984 (q1-60) int: the server-rendered /i/:id heading of an amount-only invoice names INV-001, never 'Project' / 'Proyecto'; a one-service invoice is headed by its service", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const amountOnly = await fetch(`${BASE}/invoices`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        status: "sent",
        amount: 320_00,
        billTo: { name: "Ann Lee", email: "ann@example.com" },
      }),
    }).then((r) => r.json());
    assert(typeof amountOnly.id === "string", JSON.stringify(amountOnly));

    const en = await heroTitle(amountOnly.id, "en");
    assert(en !== "Project", `the EN heading is the placeholder: "${en}"`);
    assert(
      en.includes(amountOnly.number ?? "INV-"),
      `the EN heading names the invoice ${amountOnly.number}: "${en}"`,
    );
    const es = await heroTitle(amountOnly.id, "es");
    assert(es !== "Proyecto", `the ES heading is the placeholder: "${es}"`);
    assert(
      es.includes(amountOnly.number ?? "INV-"),
      `the ES heading names the invoice ${amountOnly.number}: "${es}"`,
    );

    // The New invoice form since REQ-921: one catalogue service at a price.
    const oneService = await fetch(`${BASE}/invoices`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        status: "sent",
        amount: 320_00,
        billTo: { name: "Ann Lee", email: "ann@example.com" },
        lineItems: [{
          description: "Gutter cleaning",
          quantity: 1,
          unit: "job",
          price: 320_00,
        }],
      }),
    }).then((r) => r.json());
    assert(typeof oneService.id === "string", JSON.stringify(oneService));
    const line = await heroTitle(oneService.id, "en");
    assert(line !== "Project", `the heading is the placeholder: "${line}"`);
    assert(
      line === "Gutter cleaning",
      `the heading is the service line: "${line}"`,
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
