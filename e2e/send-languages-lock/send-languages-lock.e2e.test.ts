/**
 * REQ-925 — Raphael, 2026-11-18: "if i send an invoice, sometimes its in
 * spanish. if in settings english is only selected it should not be possible
 * to get an invoice quote or comunication that is in spanish."
 *
 * An account whose Settings → "Languages you send in" is English only (with a
 * stale Spanish default left behind), its UI in Spanish, billing Carmen, who
 * reads Spanish, on an invoice typed in Spanish:
 *  - the /invoices send sheet's "Sends in" offers English only, and "What
 *    they'll get" is English;
 *  - /i opened by a Spanish browser (pm_lang=es, ?lang=es) renders English
 *    (<html lang="en">) with no EN | ES switch.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
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
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "es", name: "Luis Ortega" }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      businessName: "Ortega Handyman Services",
      commsLanguages: ["en"],
      commsLanguage: "es",
    }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]),
  );
  return auth;
}

Deno.test("REQ-925: English only in Settings — the send sheet offers English only and /i renders English for a Spanish visitor", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Carmen Ruiz",
        email: "carmen.req925@blackhole.postmarkapp.com",
        language: "es",
      }),
    })).json();
    const job = `Faucet repair ${digits()}`;
    const created = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        jobName: job,
        status: "draft",
        netDays: 15,
        lang: "es",
        lineItems: [{
          description: job,
          quantity: 1,
          unit: "job",
          price: 45000,
        }],
        amount: 45000,
      }),
    })).json();
    if (!created?.id) throw new Error(`seed: ${JSON.stringify(created)}`);

    // the send sheet
    await page.goto("/invoices");
    const cta = page.locator("article.qcard", {
      has: page.locator("[data-cy='invoice-card-job']", { hasText: job }),
    }).first().locator("[data-cy='invoice-cta-drafting']");
    await cta.waitFor({ timeout: 20_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    const sheet = page.locator("[data-cy='send-dialog']");
    for (let i = 0; i < 20 && !(await sheet.count()); i++) {
      await cta.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    await sheet.waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='send-lang']").waitFor({ timeout: 15_000 });
    // the identity read lands after the sheet opens: wait for the ES pill to go
    const esPill = page.locator("[data-cy='send-lang-es']");
    for (let i = 0; i < 20 && (await esPill.count()); i++) {
      await page.waitForTimeout(250);
    }
    expect.eq(await esPill.count(), 0, "Sends in offers no Spanish");
    await page.locator("[data-cy='send-preview'] summary").click();
    await page.locator("[data-cy='send-preview-subject']").waitFor({
      timeout: 15_000,
    });
    const text = await page.evaluate(() =>
      document.querySelector("[data-cy='send-preview-subject']")?.textContent ??
        ""
    );
    expect(/^Invoice /.test(text.trim()), `the preview is English: ${text}`);

    // the customer's page, opened by a Spanish visitor asking for Spanish
    const sent = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        jobName: job,
        status: "sent",
        lang: "es",
        lineItems: [{
          description: job,
          quantity: 1,
          unit: "job",
          price: 45000,
        }],
        amount: 45000,
      }),
    })).json();
    if (!sent?.id) throw new Error(`seed sent: ${JSON.stringify(sent)}`);
    await page.context().clearCookies();
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].map((domain) => ({
        name: "pm_lang",
        value: "es",
        domain,
        path: "/",
      })),
    );
    await page.setExtraHTTPHeaders({ "accept-language": "es-MX,es;q=0.9" });
    await page.goto(`/i/${sent.id}?lang=es`);
    await page.locator("body").waitFor();
    const facts = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      toggle:
        document.querySelectorAll("[data-cy='public-lang-toggle']").length,
      body: document.body.innerText,
    }));
    expect.eq(facts.lang, "en", "/i paints English");
    expect.eq(facts.toggle, 0, "no EN | ES switch");
    expect(
      !/Factura|Saldo pendiente|Vence/.test(facts.body),
      "no Spanish copy on /i",
    );
  }));
