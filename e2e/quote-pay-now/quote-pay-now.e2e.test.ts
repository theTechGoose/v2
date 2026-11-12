/**
 * REQ-251 — demo issue quote-invoice-money-m13 ("Pair 9: no Pay button on a
 * signed quote whose terms say 'Pago inmediato / Al firmar'"): the customer
 * signs the quote in the browser and the signed page offers a primary
 * "Pay now $X" button that opens the invoice the signature just billed.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
) {
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: lang, name: "Pay Now Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]),
  );
  return { auth };
}

async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).click({ timeout: 2_000 });
    } catch {
      // not clickable yet (hydrating) or gone: the polls below decide
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `POST ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

Deno.test("REQ-251: signing a 'Pago inmediato' quote shows 'Pagar ahora $4,800.00', which opens the invoice the signature billed", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "es");
    const customer = await post(http, auth, "/api/customers", {
      name: "Ana Pérez",
      email: "ana@blackhole.postmarkapp.com",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Remodelación de baño",
      jobName: "Remodelación de baño",
      lineItems: [{
        description: "Remodelación de baño",
        quantity: 1,
        unit: "job",
        price: 480000,
      }],
      estimatedTotal: 480000,
      terms: [{ stepId: "payment_terms", value: "Due Now" }],
      status: "draft",
    });
    const sent = await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent" }),
    });
    await sent.body?.cancel();

    await page.goto(`/q/${quote.id}`);
    const form = page.locator("form.ctr__sign-form");
    await form.waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='quote-pay-now']").count(),
      0,
      "no Pay button before signing",
    );
    await form.locator("input[type='text']").fill("Ana Pérez");
    await clickUntil(
      page,
      "form.ctr__sign-form button[type='submit']",
      async () => (await page.locator("[data-cy='quote-pay-now']").count()) > 0,
    );

    const pay = page.locator("[data-cy='quote-pay-now']");
    await expect.see("Pagar ahora $4,800.00");
    const invoices = await (await http("/api/invoices", { headers: auth }))
      .json();
    const billed = invoices.filter((i: { quoteId?: string }) =>
      i.quoteId === quote.id
    );
    expect.eq(billed.length, 1, "the signature billed one invoice");
    expect.eq(
      await pay.getAttribute("href"),
      `/i/${billed[0].id}`,
      "Pay now links the billed invoice's public page",
    );
    await pay.click();
    await page.waitForURL(`**/i/${billed[0].id}`, { timeout: 15_000 });
  }));
