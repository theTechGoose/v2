/**
 * REQ-1099 — LOOP-007 cycle 3, issue q3-24. Raphael: "test every single
 * aspect of this application … one Opus agent per issue to do root cause
 * analysis, then one to write the test, then one to fix it and make it
 * green."
 *
 * On a deposit + balance job the balance invoice is only SCHEDULED — the
 * customer never received it. A change order on that balance opened /co
 * with "Your contractor proposed an adjustment to your invoice" and an
 * "Invoice INV-00N" link to a document she has never seen (REQ-949 promised
 * neither). The page must speak of the job and show no invoice link.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const iso = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function seed(http: StoryTools["http"]) {
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
  await call("/api/me", { name: "CO Owner", language: "en" }, "PUT");
  await call("/api/profile/identity", {
    businessName: "Patio Builders",
    commsLanguage: "en",
  }, "PUT");
  const customer = await call("/api/customers", {
    name: "Randall Belknap",
    phoneNumber: `+1512${digits()}`,
  });
  const quote = await call("/api/quotes", {
    customerId: customer.id,
    summary: "Patio",
    lineItems: [{
      description: "Patio",
      quantity: 1,
      unit: "job",
      price: 2_325_000,
    }],
    estimatedTotal: 2_325_000,
  });
  const balance = await call("/api/invoices", {
    customerId: customer.id,
    quoteId: quote.id,
    jobName: "Patio",
    status: "scheduled",
    scheduledFor: iso(20),
    dueDate: iso(34),
    lineItems: [{
      description: "Balance",
      quantity: 1,
      unit: "job",
      price: 1_860_000,
    }],
    amount: 1_860_000,
  });
  if (balance.status !== "scheduled") {
    throw new Error(`the balance should be scheduled, got ${balance.status}`);
  }
  const co = await call(`/api/invoices/${balance.id}/change-orders`, {
    description: "Extra pavers",
    deltaAmountCents: 125_000,
  });
  return {
    coId: co.id as string,
    invoiceNumber: String(balance.number),
    quoteNumber: String(quote.number),
  };
}

Deno.test("REQ-1099 (LOOP-007 q3-24): /co for a pending change order on a scheduled, never-sent balance invoice talks about the job — no 'invoice' in the intro, no invoice link, no INV number", (t) =>
  story(t, async ({ page, expect, http }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { coId, invoiceNumber, quoteNumber } = await seed(http);
    await page.goto(`/co/${coId}?lang=en`);
    await page.locator("[data-cy=co-intro]").waitFor({ timeout: 15_000 });
    // one evaluate: the intro, the invoice link and the whole page text
    const facts = await page.evaluate(() => ({
      intro: document.querySelector("[data-cy=co-intro]")?.textContent ?? "",
      invoiceLinks: document.querySelectorAll("[data-cy=co-invoice-link]")
        .length,
      text: document.body.innerText,
    }));
    expect(
      !/invoice/i.test(facts.intro),
      `the intro speaks of an invoice the customer never received (got "${facts.intro}")`,
    );
    expect.eq(
      facts.invoiceLinks,
      0,
      "no co-invoice-link to the unsent balance invoice",
    );
    expect(
      !facts.text.includes(invoiceNumber),
      `the page never names ${invoiceNumber}, which she never received`,
    );
    expect(
      facts.text.includes(quoteNumber),
      `the page still names the job ${quoteNumber}`,
    );
  }));
