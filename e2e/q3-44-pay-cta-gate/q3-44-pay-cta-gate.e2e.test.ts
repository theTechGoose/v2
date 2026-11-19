/**
 * REQ-1121 (LOOP-007 cycle 3, q3-44; amends REQ-1054) — "Receipt and invoice
 * emails say 'Pagar saldo' / 'Ver y pagar factura' when there is no way to pay
 * online".
 *
 * A business with no payment methods and no Stripe/Square emails an invoice and
 * records a part payment by check. /i shows the "contact your contractor"
 * fallback (data-cy=claim-no-methods), so the invoice email and the receipt in
 * the Outbox (GET /api/outbox/:id, the HTML as sent) must not say "View & pay
 * invoice" / "Ver y pagar factura" or "Pay the balance" / "Pagar saldo". Once
 * the business adds Venmo, a new invoice email and receipt carry both CTAs.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

const INVOICE_CTA = ["View &amp; pay invoice", "View & pay invoice", "Ver y pagar factura"];
const RECEIPT_CTA = ["Pay the balance", "Pagar saldo"];

async function call(
  http: StoryTools["http"],
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  const r = await http(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json;
}

async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
  });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: body.recoveryToken }),
    });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "es", name: "Luis Ortega", email: "luis@blackhole.postmarkapp.com" }),
  })).body?.cancel();
  // a business with NO payment methods (and no Stripe / Square), Spanish comms
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ businessName: "Pisos Ortega LLC", commsLanguage: "es" }),
  })).body?.cancel();
  // the browser is the CUSTOMER's — no owner session
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].map((domain) => ({ name: "pm_lang", value: "es", domain, path: "/" })),
  );
  return auth;
}

type Row = { id: string; kind: string; channel: string; resourceId?: string; createdAt?: string };

/** email a $1,000 invoice in Spanish, record a $400 check; the two Outbox bodies */
async function invoiceAndReceipt(http: StoryTools["http"], auth: Record<string, string>, customerId: string) {
  const inv = await call(http, "POST", "/api/invoices", auth, {
    customerId,
    jobName: "Piso de cocina",
    amount: 100000,
    status: "sent",
    dueDate: "2026-12-31",
  });
  const before = new Set(((await call(http, "GET", "/api/outbox", auth)) as Row[]).map((r) => r.id));
  await call(http, "POST", `/api/invoices/${inv.id}/email`, auth, { language: "es" });
  await call(http, "POST", "/api/payments", auth, {
    invoiceId: inv.id,
    amount: 40000,
    method: "check",
    receivedAt: new Date().toISOString(),
  });
  const fresh = ((await call(http, "GET", "/api/outbox", auth)) as Row[]).filter((r) => !before.has(r.id));
  const bodyOf = async (kind: string) => {
    const row = fresh.find((r) => r.kind === kind && r.channel === "email");
    if (!row) {
      throw new Error(`no ${kind} email in the outbox (${fresh.map((r) => `${r.kind}:${r.channel}`).join(", ")})`);
    }
    return ((await call(http, "GET", `/api/outbox/${row.id}`, auth)) as { body?: string }).body ?? "";
  };
  return { invId: inv.id as string, invoice: await bodyOf("invoice"), receipt: await bodyOf("receipt") };
}

const found = (html: string, words: string[]) => words.filter((w) => html.includes(w));

Deno.test("REQ-1121 (LOOP-007 q3-44): no online pay way — /i says contact the contractor, and neither the invoice email nor the part-payment receipt in the Outbox asks to pay; after adding Venmo both do", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const customer = await call(http, "POST", "/api/customers", auth, {
      name: "María López",
      email: "maria@blackhole.postmarkapp.com",
    });

    // ── no online pay way ──
    const bare = await invoiceAndReceipt(http, auth, customer.id);
    await page.goto(`/i/${bare.invId}`);
    await page.locator("[data-cy='claim-no-methods']").waitFor({ timeout: 15_000 });
    expect.eq(
      found(bare.invoice, INVOICE_CTA),
      [],
      "/i says contact the contractor, yet the invoice email in the Outbox asks to pay",
    );
    expect.eq(
      found(bare.receipt, RECEIPT_CTA),
      [],
      "/i says contact the contractor, yet the receipt in the Outbox asks to pay the balance",
    );

    // ── the business adds Venmo: the emails may ask for payment ──
    await call(http, "PUT", "/api/profile/identity", auth, {
      businessName: "Pisos Ortega LLC",
      commsLanguage: "es",
      acceptedPaymentMethods: { venmo: { enabled: true, handle: "@pisosortega" } },
    });
    const venmo = await invoiceAndReceipt(http, auth, customer.id);
    expect.eq(found(venmo.invoice, INVOICE_CTA).length > 0, true, "with Venmo the invoice email keeps its pay CTA");
    expect.eq(found(venmo.receipt, RECEIPT_CTA).length > 0, true, "with Venmo the receipt keeps Pagar saldo");
  }));
