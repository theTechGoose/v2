/**
 * REQ-906 — Johanna (A2Z), 2026-11-16: "También nos gustaría que el nombre
 * del cliente se vea más grande."
 *
 * In a browser: an invoice with a job name opened in the detail panel
 * (/invoices?open=<id>) shows the CUSTOMER as its title and "job · ref" as
 * the sub-line; the invoice card's client line is at least 14 px and bold;
 * the customer's own page (/i/<id>) draws the Bill-to name at 18 px.
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
    body: JSON.stringify({ language: "en", name: "Customer Name Story" }),
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

Deno.test("REQ-906: the customer is the invoice detail's title, bold on the card, 18px on the customer's page", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const name = `Robert Frakes ${digits()}`;
    const customer = await post(http, auth, "/api/customers", {
      name,
      email: "rf@blackhole.postmarkapp.com",
    });
    const job = "Maintenance 2026-10-01 → 2026-10-31";
    const inv = await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      jobName: job,
      lineItems: [
        { description: "Oct 2 — Lawn", quantity: 1, unit: "visit", price: 7000 },
      ],
      amount: 7000,
      status: "scheduled",
      scheduledFor: inDays(7),
      dueDate: inDays(37),
      netDays: 30,
    });

    // (1) the detail header: customer on top, job · ref beneath
    await page.goto(`/invoices?open=${inv.id}`);
    const panel = page.locator("[data-cy='invoice-detail']");
    const title = panel.locator("h2").first();
    await title.waitFor({ timeout: 15_000 });
    expect.eq((await title.innerText()).trim(), name, "the title is the customer");
    const sub = (await panel.locator("h2 + div").first().innerText()).trim();
    expect(
      sub.startsWith(`${job} · `) && /INV-\d+/.test(sub),
      `the sub-line is job · ref (${sub})`,
    );

    // (2) the card line is bold and at least 14px
    const card = page.locator("article.qcard", {
      has: page.locator(".qcard__client-name", { hasText: name }),
    }).first();
    const line = card.locator(".qcard__client-name");
    await line.waitFor({ timeout: 15_000 });
    const style = await line.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) };
    });
    expect(style.size >= 14, `card client line ≥ 14px (${style.size})`);
    expect(style.weight >= 700, `card client line bold (${style.weight})`);

    // (3) the customer's page: Bill-to name at 18px, From name unchanged
    await page.goto(`/i/${inv.id}`);
    const names = page.locator("[data-cy='invoice-parties'] [data-cy='party-name']");
    await names.first().waitFor({ timeout: 15_000 });
    const sizes = await names.evaluateAll((els) =>
      els.map((el) => ({
        text: (el.textContent ?? "").trim(),
        size: parseFloat(getComputedStyle(el).fontSize),
      }))
    );
    const billTo = sizes.find((s) => s.text === name);
    expect(!!billTo, `the Bill-to card names ${name}`);
    expect.eq(billTo?.size, 18, "Bill-to name is 18px");
    const from = sizes.find((s) => s.text !== name);
    expect(!!from && from.size === 15, `the From name stays 15px (${from?.size})`);
  }));
