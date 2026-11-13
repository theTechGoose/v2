/**
 * REQ-695 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issues M23 and m55.
 *
 * (a) M23 — issuing an invoice in the Spanish UI to a client with an email
 *     and no phone showed "Factura enviada por correo · El texto no salió:
 *     no recipient: pass `to` or attach a customer with a phone number".
 *     Now the page fires only the email, and nothing on /invoices says
 *     "recipient".
 * (b) m55 — "Finish + send" on a draft for a client with no email and no
 *     phone was a text-only dead end. Now the card offers an inline
 *     "Add email or phone": typing an email saves it on the customer and
 *     sends the invoice, in place.
 *
 * Page: /invoices (front-end/islands/InvoicesPage.tsx).
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
    body: JSON.stringify({ language: lang, name: "Dispatch Contact Story" }),
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

Deno.test("REQ-695 (cycle 5, M23): issuing an invoice in Spanish to a client with an email and no phone never shows 'recipient' — only the email is fired", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "es");
    const customer = await post(http, auth, "/api/customers", {
      name: "Lucía Paredes",
      email: "lp@blackhole.postmarkapp.com",
    });
    const texts: string[] = [];
    page.on("request", (r) => {
      if (/\/api\/invoices\/[^/]+\/text$/.test(r.url())) texts.push(r.url());
    });

    await page.goto("/invoices?new=1");
    await page.locator("[data-cy='new-invoice-modal']").waitFor({
      timeout: 15_000,
    });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.locator("[data-cy='new-invoice-client']").selectOption(
      customer.id,
    );
    await page.locator("[data-cy='new-invoice-amount']").fill("900");
    // The submit sends, then reloads /invoices. A locator click's evidence
    // frame lands mid-navigation and the screenshot hangs (shots-lib), so the
    // button is pressed in the page and the reload awaited instead.
    await Promise.all([
      page.waitForURL((u) => !u.searchParams.has("new"), { timeout: 30_000 }),
      page.locator("[data-cy='new-invoice-submit']").evaluate(
        (b: { click(): void }) => b.click(),
      ),
    ]);
    await page.waitForLoadState("networkidle").catch(() => {});
    const body = await page.locator("body").innerText();
    expect(!/recipient/i.test(body), "no developer 'recipient' text anywhere");
    expect.eq(
      await page.locator("[data-cy='send-partial']").count(),
      0,
      "a phone-less client's bill is not a half-delivered send",
    );
    expect.eq(texts.length, 0, "no text was fired for a client with no phone");

    const all = await (await http("/api/invoices", { headers: auth }))
      .json() as Array<{ customerId?: string; status?: string }>;
    const mine = all.filter((i) => i.customerId === customer.id);
    expect.eq(mine[0]?.status, "sent", "the email delivered it");
  }));

Deno.test("REQ-695 (cycle 5, m55): 'Finish + send' with no contact on file offers an inline 'Add email or phone' — typing an email saves it on the customer and sends, in place", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "en");
    const customer = await post(http, auth, "/api/customers", {
      name: "Nobody Reachable",
    });
    const job = `Fence stain ${digits()}`;
    await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      jobName: job,
      lineItems: [{ description: job, quantity: 1, unit: "job", price: 30000 }],
      amount: 30000,
      status: "draft",
      dueDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(
        0,
        10,
      ),
    });

    await page.goto("/invoices");
    const card = page.locator("article.qcard", {
      has: page.locator("[data-cy='invoice-card-job']", { hasText: job }),
    }).first();
    const cta = card.locator("[data-cy='invoice-cta-drafting']");
    await cta.waitFor({ timeout: 15_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await cta.click();

    const fix = card.locator("[data-cy='invoice-add-contact']");
    await fix.waitFor({ timeout: 15_000 });
    expect(
      (await card.locator("[data-cy='invoice-add-contact-open']").getAttribute(
        "href",
      ))?.includes(`open=${customer.id}`) ?? false,
      "a link to the client's own card",
    );
    await fix.locator("[data-cy='invoice-add-contact-input']").fill(
      "nobody@blackhole.postmarkapp.com",
    );
    await fix.locator("[data-cy='invoice-add-contact-save']").click();

    await page.locator("[data-cy='invoice-sent']").waitFor({
      timeout: 20_000,
    });
    const saved = await (await http(`/api/customers/${customer.id}`, {
      headers: auth,
    })).json();
    expect.eq(
      saved.email,
      "nobody@blackhole.postmarkapp.com",
      "the email is saved on the customer",
    );
    const all = await (await http("/api/invoices", { headers: auth }))
      .json() as Array<{ customerId?: string; status?: string }>;
    expect.eq(
      all.find((i) => i.customerId === customer.id)?.status,
      "sent",
      "the draft went out",
    );
  }));
