/**
 * REQ-268 — demo issue M35, in a browser: once an invoice is paid in full,
 * its public page (/i/:id) thanks the customer with a written-out date — never
 * the raw ISO timestamp the payment was stamped with.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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

async function paidInvoice(
  http: StoryTools["http"],
  language: "en" | "es",
) {
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language, name: "Rosa Paid" }),
  });
  await me.body?.cancel();
  const customer = await post(http, auth, "/api/customers", {
    name: "Hans Hansen",
    email: "hans@blackhole.postmarkapp.com",
    preferredLanguage: language,
  });
  const invoice = await post(http, auth, "/api/invoices", {
    customerId: customer.id,
    amount: 40000,
    dueDate: "2026-12-01",
    issuedDate: "2026-11-06",
    status: "sent",
    jobName: "Deck rebuild",
  });
  await post(http, auth, "/api/payments", {
    invoiceId: invoice.id,
    amount: 40000,
    method: "zelle",
    receivedAt: "2026-11-11T20:57:57.358Z",
  });
  return invoice;
}

for (
  const [lang, text] of [
    ["es", "confirmó tu pago el 11 de noviembre de 2026"],
    ["en", "confirmed your payment on November 11, 2026"],
  ] as const
) {
  Deno.test(`REQ-268 (M35): a paid public invoice in ${lang} thanks the customer with a written-out date, not an ISO timestamp`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const invoice = await paidInvoice(http, lang);
      // the visitor's saved language (pm_lang) picks the page's language
      const hosts = new Set([
        new URL(baseUrl).hostname,
        "localhost",
        "127.0.0.1",
      ]);
      await page.context().addCookies(
        [...hosts].map((domain) => ({
          name: "pm_lang",
          value: lang,
          domain,
          path: "/",
        })),
      );
      await page.goto(`/i/${invoice.id}`);
      await page.getByText(text).first().waitFor({ timeout: 15_000 });
      await expect.see(text);
      const body = await page.locator("body").innerText();
      expect.eq(
        /\d{4}-\d{2}-\d{2}T\d{2}:/.test(body),
        false,
        "no raw ISO timestamp anywhere on the page",
      );
    }));
}
