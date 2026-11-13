/**
 * REQ-247 — demo issue quote-invoice-money-m8: the out-for-payment invoice
 * card's front button read "Payment received → →". On the real shell, in both
 * languages, it reads the CTA with exactly one arrow.
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
    body: JSON.stringify({ language: lang, name: "Arrow Story" }),
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

async function mkOutInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const customer = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Randall Belknap",
      email: "rb@blackhole.postmarkapp.com",
    }),
  })).json();
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const r = await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: customer.id,
      status: "sent",
      issuedDate: today,
      dueDate: due,
      jobName: "Arrow check",
      lineItems: [{
        description: "Lawn",
        quantity: 1,
        unit: "visit",
        price: 6500,
      }],
      amount: 6500,
    }),
  });
  return await r.json();
}

for (
  const [lang, label] of [["en", "Payment received"], [
    "es",
    "Pago recibido",
  ]] as const
) {
  Deno.test(`REQ-247: the out-for-payment invoice card reads '${label} →' with one arrow (${lang})`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const { auth } = await signIn(http, page, baseUrl, lang);
      await mkOutInvoice(http, auth);
      await page.goto("/invoices");
      const cta = page.locator("[data-cy='invoice-cta-out']").first();
      await cta.waitFor({ timeout: 15_000 });
      const text = (await cta.innerText()).replace(/\s+/g, " ").trim();
      expect(text.startsWith(label), `the CTA reads '${label}…' (${text})`);
      expect.eq(
        (text.match(/→/g) ?? []).length,
        1,
        `exactly one arrow on the front button (${text})`,
      );
    }));
}
