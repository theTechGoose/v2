/**
 * REQ-710 — Raphael, 2026-11-12: "fix every issue the demo found, loop until
 * there are none." Demo-loop cycle 5, issue M4 (pair 9): the customer's
 * ENGLISH page of a standalone invoice typed in Spanish showed an English
 * title over the Spanish line "Retiro de refrigerador y lavadora", and the
 * payment instructions "Zelle: +1 (512) 555-0108 · Efectivo" beside a "Cash"
 * button.
 *
 * TranslateInvoice now fills each line's `descriptionByLang`; the lane's stub
 * model cannot translate, so the story writes the copies the real model
 * makes through PUT /invoices/:id (the editor round-trips them) and checks
 * what /i renders: the line in English (`invoiceLineItemsByLang` →
 * `localizeLineItems`) and the payment method's label in English
 * (`localizePaymentInstructions`) — and the Spanish page left as typed.
 *
 * Page: front-end/routes/i/[id].tsx; projection: GET /invoices/:id/public.
 */
import { story, type StoryTools } from "#shots";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

const LINE_ES = "Retiro de refrigerador y lavadora";
const LINE_EN = "Removal of refrigerator and washing machine";

/** A Spanish-sending contractor's standalone invoice, its line's English
 *  copy stored as TranslateInvoice stores it; returns the invoice id. */
async function seedInvoice(http: StoryTools["http"]): Promise<string> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
  const auth = { ...JSON_HEADERS, cookie };
  const call = async (path: string, payload: unknown, method = "POST") => {
    const res = await http(path, {
      method,
      headers: auth,
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(
        `${method} ${path} → ${res.status} ${JSON.stringify(json)}`,
      );
    }
    return json;
  };
  await call("/api/me", { name: "Rosa Díaz", language: "es" }, "PUT");
  await call("/api/profile/identity", {
    businessName: "Díaz Hauling",
    commsLanguage: "es",
  }, "PUT");
  const customer = await call("/api/customers", {
    name: "Jorge Ruiz",
    phoneNumber: "+15125550974",
  });
  const line = {
    description: LINE_ES,
    quantity: 1,
    unit: "job",
    price: 20000,
  };
  const invoice = await call("/api/invoices", {
    customerId: customer.id,
    jobName: "Retiro de electrodomésticos",
    lineItems: [line],
    amount: 20000,
    dueDate: "2026-12-30",
    paymentInstructions: "Zelle: +1 (512) 555-0108 · Efectivo",
  });
  // The real model's work (the stub's reply is not a translation).
  await call(`/api/invoices/${invoice.id}`, {
    jobNameByLang: {
      es: "Retiro de electrodomésticos",
      en: "Appliance Removal",
    },
    lineItems: [{
      ...line,
      descriptionByLang: { es: LINE_ES, en: LINE_EN },
    }],
  }, "PUT");
  return invoice.id as string;
}

const bodyText = (page: StoryTools["page"]) => page.locator("body").innerText();

Deno.test("REQ-710 M4 (pair 9): the English page of a standalone invoice typed in Spanish shows its line and its payment method in English; the Spanish page keeps them as typed", (t) =>
  story(t, async ({ page, expect, http }) => {
    const invoiceId = await seedInvoice(http);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto(`/i/${invoiceId}?lang=en`);
    // the first visit compiles /i on demand — generous on a loaded host
    await expect.see("Download PDF", { timeout: 60_000 });
    await expect.see(LINE_EN, { timeout: 10_000 });
    const en = await bodyText(page);
    expect(!en.includes(LINE_ES), `the Spanish line on the English page`);
    expect(
      en.includes("Zelle: +1 (512) 555-0108 · Cash"),
      "the payment instructions name the cash method in English",
    );
    expect(!en.includes("Efectivo"), "'Efectivo' on the English page");

    await page.goto(`/i/${invoiceId}?lang=es`);
    await expect.see("Descargar PDF", { timeout: 20_000 });
    await expect.see(LINE_ES, { timeout: 10_000 });
    const es = await bodyText(page);
    expect(!es.includes(LINE_EN), "the English line on the Spanish page");
    expect(
      es.includes("Zelle: +1 (512) 555-0108 · Efectivo"),
      "the Spanish page keeps the instructions as typed",
    );
  }));
