/**
 * REQ-470 — demo-loop cycle 3, issue m61 ("One-letter legal name ('x') signs
 * a binding agreement"): on /q/:id the customer types "x" as their legal
 * name. The "Sign the agreement" button stays disabled with an inline hint
 * asking for first and last name; typing a real name enables it.
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
    body: JSON.stringify({ language: lang, name: "Signer Name Story" }),
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

Deno.test("REQ-470 m61: a one-letter legal name cannot sign — the button stays disabled with an inline hint; a real name enables it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "en");
    const customer = await post(http, auth, "/api/customers", {
      name: "Ana Pérez",
      email: "ana@blackhole.postmarkapp.com",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Fence repair",
      jobName: "Fence repair",
      lineItems: [{
        description: "Fence repair",
        quantity: 1,
        unit: "job",
        price: 120000,
      }],
      estimatedTotal: 120000,
      status: "draft",
    });
    const sent = await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent" }),
    });
    await sent.body?.cancel();
    // the customer's view: no owner session on the public page
    await page.context().clearCookies();

    await page.goto(`/q/${quote.id}`);
    const form = page.locator("form.ctr__sign-form");
    await form.waitFor({ timeout: 15_000 });
    const input = form.locator("input[type='text']");
    const button = form.locator("button[type='submit']");
    const hint = form.locator("[data-cy='sign-name-invalid']");

    // hydration: keep typing until the island reacts with the hint
    for (let i = 0; i < 25 && (await hint.count()) === 0; i++) {
      await input.fill("");
      await input.type("x");
      await page.waitForTimeout(300);
    }
    expect.eq(await hint.count(), 1, "the inline hint shows for 'x'");
    expect.eq(await button.isDisabled(), true, "'x' cannot sign");
    await expect.see("first and last name");

    await input.fill("Ana Pérez");
    await page.waitForTimeout(300);
    expect.eq(await hint.count(), 0, "no hint for a real name");
    expect.eq(await button.isDisabled(), false, "a real name can sign");
  }));
