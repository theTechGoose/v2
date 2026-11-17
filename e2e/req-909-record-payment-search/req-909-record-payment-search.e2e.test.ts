/**
 * REQ-909 — Johanna (A2Z), 2026-11-16, videos 1 and 2: she has a check in her
 * hand and wants the invoice it pays. The Record-a-payment picker lets her
 * TYPE the customer (or the number, or the job) and pick the invoice; the
 * topbar search's invoice row offers "Record payment", which lands on
 * /payments with that invoice already picked.
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
    body: JSON.stringify({ language: "en", name: "Record Payment Story" }),
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

Deno.test("REQ-909: Record a payment finds the invoice by typing the customer; the topbar search's invoice row opens Record a payment on that invoice", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const name = `Johanna Check ${digits()}`;
    const customer = await post(http, auth, "/api/customers", {
      name,
      email: "jc@blackhole.postmarkapp.com",
    });
    const inv = await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      jobName: "Maintenance 2026-10-01 → 2026-10-31",
      lineItems: [2, 9, 16, 23, 30].map((d) => ({
        description: `Oct ${d} — Lawn`,
        quantity: 1,
        unit: "visit",
        price: 7000,
      })),
      amount: 35000,
      status: "sent",
      issuedDate: "2026-11-01",
      dueDate: "2026-12-01",
    });

    // (1) /payments → Record a payment → type the customer → pick the row
    await page.goto("/payments");
    await page.locator("[data-cy='payments-record']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='payments-record']").click();
    const box = page.locator(`${PICKER} [data-cy='search-select-input']`);
    await box.waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator(`${PICKER} select`).count(),
      0,
      "the picker is no longer a native select",
    );
    await box.fill("Johanna Check");
    const option = page.locator(`${PICKER} [data-cy='search-select-option']`)
      .filter({ hasText: name }).first();
    await option.waitFor({ timeout: 15_000 });
    await option.click();
    await page.locator("[data-cy='pay-received-date']").waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator(PICKER).getAttribute("data-value"),
      inv.id,
      "the typed-and-picked invoice is the one the form records against",
    );

    // (2) the topbar search: the invoice row carries "Record payment" → /payments?record=<id>
    await page.goto("/payments");
    const input = page.locator("[data-cy='global-search-input']");
    await input.waitFor({ timeout: 15_000 });
    await input.fill(name);
    const panel =
      `[data-cy='global-search-results'][data-state='ready'][data-q='${name}']`;
    await page.locator(panel).waitFor({ timeout: 15_000 });
    const row = page.locator(
      `${panel} [data-cy='global-search-row'][data-type='invoice'][data-id='${inv.id}']`,
    );
    await row.waitFor({ timeout: 15_000 });
    const action = row.locator("a[data-cy='global-search-record']");
    await action.waitFor({ timeout: 15_000 });
    expect.eq(
      await action.getAttribute("href"),
      `/payments?record=${inv.id}`,
      "the row's action is the deep link",
    );
    await action.click();
    await page.waitForURL((u) => u.searchParams.get("record") === inv.id, {
      timeout: 15_000,
    });
    await page.locator("[data-cy='payments-record-modal']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='pay-received-date']").waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator(PICKER).getAttribute("data-value"),
      inv.id,
      "the deep link opened Record a payment on that invoice",
    );
  }));
