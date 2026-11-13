/**
 * REQ-685 — demo-loop cycle 5, issue m42: "Change order Version 2 doesn't
 * say what changed."
 *
 * In a browser: the owner edits a sent change order (+$850 → +$1,000, new
 * description), so it is Version 2. The customer's /co link says what
 * changed — "What changed in Version 2: Amount +$850.00 → +$1,000.00 ·
 * Description: …" — and the same in Spanish under ?lang=es.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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
    businessName: "Cambio Builders",
    commsLanguage: "es",
  }, "PUT");
  const customer = await call("/api/customers", {
    name: "Juan Pérez",
    phoneNumber: `+1512${digits()}`,
  });
  const quote = await call("/api/quotes", {
    customerId: customer.id,
    summary: "Kitchen remodel",
    lineItems: [{
      description: "Kitchen remodel",
      quantity: 1,
      unit: "job",
      price: 1_920_000,
    }],
    estimatedTotal: 1_920_000,
  });
  const invoice = await call("/api/invoices", {
    customerId: customer.id,
    quoteId: quote.id,
    jobName: "Kitchen remodel",
    lineItems: [{
      description: "Balance",
      quantity: 1,
      unit: "job",
      price: 960_000,
    }],
    amount: 960_000,
    dueDate: "2026-12-30",
  });
  const co = await call(`/api/invoices/${invoice.id}/change-orders`, {
    description: "Add pantry shelving",
    deltaAmountCents: 85_000,
  });
  // REQ-685: the owner edits the order — Version 2, amount and description
  await call(`/api/invoices/${invoice.id}/change-orders/${co.id}`, {
    description: "Add pantry shelving and trim",
    deltaAmountCents: 100_000,
  }, "PUT");
  return { cookie, coId: co.id as string };
}

Deno.test("REQ-685 m42: /co for an edited change order says what changed in Version 2, in EN and ES", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { coId } = await seed(http);
    await page.setViewportSize({ width: 1280, height: 900 });

    // the customer: no session
    await page.goto(`${baseUrl}/co/${coId}?lang=en`);
    const changes = page.locator("[data-cy=co-changes]");
    await changes.waitFor({ timeout: 15_000 });
    const en = await changes.innerText();
    expect(
      en.includes("What changed in Version 2") &&
        en.includes("Amount +$850.00 → +$1,000.00") &&
        en.includes("Add pantry shelving and trim"),
      `EN what-changed line (got "${en}")`,
    );

    await page.goto(`${baseUrl}/co/${coId}?lang=es`);
    await changes.waitFor({ timeout: 15_000 });
    const es = await changes.innerText();
    expect(
      es.includes("Qué cambió en la Versión 2") &&
        es.includes("Monto +$850.00 → +$1,000.00"),
      `ES what-changed line (got "${es}")`,
    );
  }));
