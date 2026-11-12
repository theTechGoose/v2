/**
 * REQ-492 — demo-loop cycle 3, issue M29: "Public invoice switches EN→ES
 * when the client clicks Pay from an English quote".
 *
 * A Spanish-comms contractor (commsLanguage "es") sends a quote. The
 * customer opens /q in a FRESH browser (no pm_lang cookie) — /q is English
 * first (REQ-048) — signs, and clicks "Pay now". The invoice page must open
 * in English too: the hand-off carries ?lang=en, beating /i's commsLanguage
 * default.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** Sign the contractor in over HTTP only — the browser stays cookie-free. */
async function contractor(http: StoryTools["http"]) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const call = async (path: string, payload: unknown, method = "POST") => {
    const res = await http(path, {
      method,
      headers: auth,
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
    }
    return json;
  };
  return { auth, call };
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

Deno.test("REQ-492 (M29): a fresh browser opens /q in English, signs, clicks Pay now — /i opens in English (html lang=en), not the contractor's Spanish", (t) =>
  story(t, async ({ page, expect, http }) => {
    const { auth, call } = await contractor(http);
    await call("/api/me", { name: "Mateo Ruiz", language: "es" }, "PUT");
    await call("/api/profile/identity", {
      businessName: "Ruiz Remodelación",
      commsLanguage: "es",
    }, "PUT");
    const customer = await call("/api/customers", {
      name: "Sam Carter",
      email: "sam@blackhole.postmarkapp.com",
    });
    const quote = await call("/api/quotes", {
      customerId: customer.id,
      summary: "Fence repair",
      jobName: "Fence repair",
      lineItems: [{
        description: "Fence repair",
        quantity: 1,
        unit: "job",
        price: 45000,
      }],
      estimatedTotal: 45000,
      terms: [{ stepId: "payment_terms", value: "Due Now" }],
      status: "draft",
    });
    await call(`/api/quotes/${quote.id}`, { status: "sent" }, "PUT");

    // the customer's browser: no cookies at all
    expect.eq((await page.context().cookies()).length, 0, "fresh browser");
    await page.goto(`/q/${quote.id}`);
    const form = page.locator("form.ctr__sign-form");
    await form.waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("html").getAttribute("lang"),
      "en",
      "/q opens in English",
    );
    await form.locator("input[type='text']").fill("Sam Carter");
    await clickUntil(
      page,
      "form.ctr__sign-form button[type='submit']",
      async () => (await page.locator("[data-cy='quote-pay-now']").count()) > 0,
    );
    await expect.see("Pay now $450.00");

    const invoices = await (await http("/api/invoices", { headers: auth }))
      .json();
    const billed = invoices.filter((i: { quoteId?: string }) =>
      i.quoteId === quote.id
    );
    expect.eq(billed.length, 1, "the signature billed one invoice");

    await page.locator("[data-cy='quote-pay-now']").click();
    await page.waitForURL((u) => u.pathname === `/i/${billed[0].id}`, {
      timeout: 15_000,
    });
    expect.eq(
      await page.locator("html").getAttribute("lang"),
      "en",
      "/i keeps the English the customer was reading",
    );
  }));
