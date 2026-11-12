/**
 * REQ-558 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4 (run r857a9d67), issue m42: Juan, logged out,
 * opened a scheduled installment on /i/ and read "Programada" — the owner's
 * lifecycle word. A customer reads "Factura · vence <date>"; the business's
 * own preview keeps "Programada".
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
    body: JSON.stringify({ language: lang, name: "Card Story" }),
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

const iso = (days: number) =>
  new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

Deno.test("REQ-558 (demo m42): a scheduled installment's /i/ headline says 'Factura · vence …' to the customer, 'Programada' only to the business", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "es");
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Juan Cliente",
        email: "juan@blackhole.postmarkapp.com",
      }),
    })).json();
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        lineItems: [{
          description: "Pintura",
          quantity: 1,
          unit: "job",
          price: 40000,
        }],
        amount: 40000,
        status: "scheduled",
        scheduledFor: iso(20),
        dueDate: iso(34),
        jobName: "Cuota programada",
      }),
    })).json();
    expect(!!inv.id, `invoice created (${JSON.stringify(inv)})`);

    const headline = page.locator("[data-cy='invoice-headline']");
    // The business's own preview keeps its lifecycle word.
    await page.goto(`/i/${inv.id}`);
    await headline.waitFor({ timeout: 15_000 });
    const owner = (await headline.innerText()).trim();
    expect(owner.includes("Programada"), `owner preview: ${owner}`);

    // The customer, logged out, never reads it.
    await page.context().clearCookies();
    await page.context().addCookies([{
      name: "pm_lang",
      value: "es",
      domain: new URL(baseUrl).hostname,
      path: "/",
    }]);
    await page.goto(`/i/${inv.id}`);
    await headline.waitFor({ timeout: 15_000 });
    const client = (await headline.innerText()).trim();
    expect(!client.includes("Programada"), `customer headline: ${client}`);
    expect(
      client.includes("Factura · vence"),
      `customer headline reads 'Factura · vence …': ${client}`,
    );
  }));
