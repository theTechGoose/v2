/**
 * REQ-268 — demo issue M35, over the REAL dev stack (frontend :5280, which
 * proxies /api to the backend): a contractor records a payment that settles
 * the invoice, and the server-rendered public invoice (/i/:id) thanks the
 * customer with a written-out date.
 *
 * Red against develop 53f3cfc (2026-11-11): the page said
 *   "¡Gracias! … confirmó tu pago el 2026-11-11T20:57:57.358Z."
 */
const FE = process.env.FRONTEND_BASE_URL ?? "http://localhost:5280";
const JSON_HEADERS = { "content-type": "application/json" };
const RECEIVED_AT = "2026-11-11T20:57:57.358Z";

async function post(path: string, cookie: string, body: unknown) {
  const res = await fetch(`${FE}${path}`, {
    method: "POST",
    headers: { ...JSON_HEADERS, cookie },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`POST ${path} → ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function paidInvoiceId(): Promise<string> {
  const phone = `+1512${Math.floor(Math.random() * 9_000_000) + 1_000_000}`;
  const r = await fetch(`${FE}/api/auth/verify`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
  });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await fetch(`${FE}/api/auth/start-fresh`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: body.recoveryToken }),
    });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  const customer = await post("/api/customers", cookie, {
    name: "Hans Hansen",
  });
  const invoice = await post("/api/invoices", cookie, {
    customerId: customer.id,
    amount: 40000,
    dueDate: "2026-12-01",
    status: "sent",
  });
  await post("/api/payments", cookie, {
    invoiceId: invoice.id,
    amount: 40000,
    method: "zelle",
    receivedAt: RECEIVED_AT,
  });
  return invoice.id;
}

describe("REQ-268 (M35) the paid public invoice writes the payment date out", () => {
  let id = "";
  beforeAll(async () => {
    id = await paidInvoiceId();
  });

  for (
    const [lang, sentence] of [
      ["es", "confirmó tu pago el 11 de noviembre de 2026."],
      ["en", "confirmed your payment on November 11, 2026."],
    ] as const
  ) {
    it(`REQ-268 GET /i/:id (pm_lang=${lang}) says "${sentence}" and carries no ISO timestamp`, async () => {
      const res = await fetch(`${FE}/i/${id}`, {
        headers: { cookie: `pm_lang=${lang}` },
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(sentence);
      expect(html).not.toContain(RECEIVED_AT);
    });
  }
});
