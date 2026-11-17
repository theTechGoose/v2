/**
 * REQ-275 — demo issue i18n-formatting-m13, on the real shell: the copy the
 * demo agents read as typos ("Once a agreement", "pagó por por Zelle",
 * "1 confirmadas", "customer.They'll").
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
    body: JSON.stringify({ language: lang, name: "Copy Story" }),
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
  await page.addInitScript((l) => {
    try {
      localStorage.setItem("pm:lang", l);
    } catch { /* storage off */ }
  }, lang);
  return { auth };
}

async function sentInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
  jobName: string,
) {
  const customer = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "María Pagadora",
      email: "mp@blackhole.postmarkapp.com",
    }),
  })).json();
  const inv = await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: customer.id,
      status: "sent",
      jobName,
      lineItems: [{
        description: jobName,
        quantity: 1,
        unit: "job",
        price: 37000,
      }],
      amount: 37000,
    }),
  })).json();
  return inv;
}

Deno.test("REQ-275: the empty invoices page says 'Once an agreement is signed' and the empty clients hero reads 'customer. They'll'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl, "en");
    await page.goto("/invoices");
    const sub = page.getByText(/Once an? agreement is signed/);
    await sub.first().waitFor({ timeout: 15_000 });
    const subText = (await sub.first().textContent()) ?? "";
    expect(
      subText.includes("Once an agreement is signed"),
      `the empty sub says 'Once an agreement' (${subText.slice(0, 40)})`,
    );

    await page.goto("/clients");
    const h1 = page.locator("h1.ph2__title");
    await h1.waitFor({ timeout: 15_000 });
    const title = ((await h1.textContent()) ?? "").replace(/\s+/g, " ");
    expect(
      title.includes("first customer. They'll"),
      `the hero's text keeps a space between its sentences (${title})`,
    );
  }));

Deno.test("REQ-275: a Zelle claim reads 'pagó por Zelle' (one 'por'), and one confirmed payment is '1 confirmada'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "es");
    const inv = await sentInvoice(http, auth, "Patio de adoquines");
    const claim = await http(`/api/invoices/${inv.id}/claim-payment`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ method: "zelle", claimedBy: "María Pagadora" }),
    });
    const claimBody = await claim.json();
    expect.eq(claimBody.ok, true, "the customer's Zelle claim is accepted");

    await page.goto("/invoices");
    const read = page.locator(".qcard__read", { hasText: "María Pagadora" });
    await read.first().waitFor({ state: "attached", timeout: 15_000 });
    const readText = (await read.first().textContent()) ?? "";
    expect(
      readText.includes("dice que pagó por Zelle."),
      `the claim reads 'pagó por Zelle' (${readText})`,
    );
    expect(!/por por/.test(readText), `no 'por por' (${readText})`);

    const confirm = await http(`/api/invoices/${inv.id}/confirm-payment`, {
      method: "POST",
      headers: auth,
    });
    await confirm.body?.cancel();
    expect.eq(confirm.status, 200, "the contractor confirms the payment");

    await page.goto("/invoices");
    const kpi = page.locator(".qkpi__sub", { hasText: /confirmad/ });
    await kpi.first().waitFor({ timeout: 15_000 });
    const kpiText = ((await kpi.first().textContent()) ?? "").trim();
    expect.eq(kpiText, "1 confirmada", "one cleared payment is singular");
  }));
