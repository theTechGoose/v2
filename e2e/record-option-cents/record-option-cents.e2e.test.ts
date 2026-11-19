/**
 * REQ-1081 — Raphael (LOOP-007): "test every single aspect of this
 * application … one Opus agent per issue to do root cause analysis, then one
 * to write the test, then one to fix it and make it green". QA issue q3-16
 * (cycle 3): /payments → Record a payment listed
 * "INV-002 · Greg Pruitt · $1,001" while the Amount field below read
 * "1000.5". The option must show the balance still owed, to the cent
 * (REQ-961), the same figure the Amount field pre-fills.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
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
    body: JSON.stringify({ language: "en", name: "Record Option Cents Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  url: string,
  body: unknown,
) {
  const r = await http(url, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const PICKER = "[data-cy='payments-record-invoice']";

async function openOption(
  page: StoryTools["page"],
  name: string,
): Promise<string> {
  await page.goto("/payments");
  const record = page.locator("[data-cy='payments-record']");
  await record.waitFor({ timeout: 15_000 });
  await record.click();
  const box = page.locator(`${PICKER} [data-cy='search-select-input']`);
  await box.waitFor({ timeout: 15_000 });
  await box.fill("Greg");
  const option = page.locator(`${PICKER} [data-cy='search-select-option']`)
    .filter({ hasText: name }).first();
  await option.waitFor({ timeout: 15_000 });
  const text = (await option.textContent()) ?? "";
  await option.click();
  await page.locator("[data-cy='pay-received-amount']").waitFor({
    timeout: 15_000,
  });
  return text;
}

const dollars = (text: string) => {
  const m = text.match(/\$([\d,]+(?:\.\d+)?)\s*$/);
  return m ? Number(m[1].replace(/,/g, "")) : NaN;
};

Deno.test('REQ-1081 q3-16: the Record a payment option for a $1,000.50 invoice reads "$1,000.50" (not "$1,001") and matches the Amount field; after $500 it reads "$500.50"', (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const name = `Greg Pruitt ${digits()}`;
    const customer = await post(http, auth, "/api/customers", {
      name,
      email: "gp@blackhole.postmarkapp.com",
    });
    const inv = await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      jobName: "Deck repair",
      lineItems: [{
        description: "Deck repair",
        quantity: 1,
        unit: "job",
        price: 100050,
      }],
      amount: 100050,
      status: "sent",
      issuedDate: inDays(0),
      dueDate: inDays(30),
    });

    // (1) the full, unpaid invoice
    const first = await openOption(page, name);
    const field = page.locator("[data-cy='pay-received-amount']");
    const value = await field.inputValue();
    expect(
      !first.includes("$1,001"),
      `the option does not round the cents: "${first}" (field "${value}")`,
    );
    expect(
      first.includes("$1,000.50"),
      `the option shows $1,000.50 to the cent: "${first}"`,
    );
    expect.eq(
      dollars(first),
      Number(value),
      `the option's amount matches the Amount field ("${first}" vs "${value}")`,
    );

    // (2) record $500, reopen: the option shows the balance still owed
    await post(http, auth, "/api/payments", {
      invoiceId: inv.id,
      amount: 50000,
      method: "check",
      reference: "1081",
      receivedAt: new Date().toISOString(),
    });
    const second = await openOption(page, name);
    const value2 = await field.inputValue();
    expect(
      second.includes("$500.50"),
      `the part-paid option shows the $500.50 balance: "${second}" (field "${value2}")`,
    );
    expect.eq(
      dollars(second),
      Number(value2),
      `the option's amount matches the Amount field ("${second}" vs "${value2}")`,
    );
  }));
