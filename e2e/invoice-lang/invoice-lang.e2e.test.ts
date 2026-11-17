/**
 * REQ-272 — Raphael, 2026-11-11: "fix every issue the demo found". Demo issue
 * i18n-formatting-m7: "Public invoice /i/ has no EN/ES switch; the quote page
 * has one".
 *
 * The contractor sends in SPANISH (commsLanguage es); the customer opens the
 * invoice link with no language cookie, so it opens in Spanish — and the
 * EN | ES toggle above the document switches it to English, remembers the
 * pick, and switches back.
 *
 * Copy pinned (lang/{en,es}.json): publicInvoice.downloadPdf "Download PDF" /
 * "Descargar PDF".
 *
 * Page: front-end/routes/i/[id].tsx (toggle island
 * front-end/islands/PublicLangToggle.tsx, the pick in
 * shared/quote-flow/public-lang.ts).
 */
import { story, type StoryTools } from "#shots";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

/** A Spanish-sending contractor with one invoice; returns the invoice id.
 *  The page's own browser context stays cookie-less: the customer's view. */
async function seedInvoice(http: StoryTools["http"]): Promise<string> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
  const auth = { ...JSON_HEADERS, cookie };
  const post = async (path: string, payload: unknown, method = "POST") => {
    const res = await http(path, {
      method,
      headers: auth,
      body: JSON.stringify(payload),
    });
    return await res.json();
  };
  await post("/api/me", { name: "Factura User", language: "es" }, "PUT");
  await post("/api/profile/identity", {
    businessName: "Factura ES LLC",
    commsLanguage: "es",
  }, "PUT");
  const customer = await post("/api/customers", {
    name: "Lucía Ortega",
    phoneNumber: "+15125550973",
  });
  const invoice = await post("/api/invoices", {
    customerId: customer.id,
    jobName: "Pintura interior",
    lineItems: [{
      description: "Pintura",
      quantity: 1,
      unit: "job",
      price: 120000,
    }],
    amount: 120000,
    dueDate: "2026-12-30",
  });
  return invoice.id as string;
}

const bodyText = (page: StoryTools["page"]) => page.locator("body").innerText();
const current = (page: StoryTools["page"], lang: "en" | "es") =>
  page.locator(`a[data-public-lang=${lang}]`).getAttribute("aria-current");

Deno.test("REQ-272: the public invoice has an EN | ES toggle that switches it to English and back, and remembers the pick", (t) =>
  story(t, async ({ page, expect, http }) => {
    const invoiceId = await seedInvoice(http);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/i/${invoiceId}`);
    await expect.see("Descargar PDF", { timeout: 15_000 });
    expect.eq(await current(page, "es"), "true", "ES is the current language");
    expect.eq(await current(page, "en"), "false", "EN is not");

    await page.locator("a[data-public-lang=en]").click();
    await expect.see("Download PDF", { timeout: 15_000 });
    expect(
      !(await bodyText(page)).includes("Descargar PDF"),
      "no Spanish chrome left",
    );
    expect.eq(await current(page, "en"), "true", "EN is now current");
    expect.eq(
      new URL(page.url()).search,
      "?lang=en",
      "the link carries the pick",
    );
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "<html lang> follows",
    );

    // A plain visit (no ?lang=) now opens English — the pick was persisted.
    await page.goto(`/i/${invoiceId}`);
    await expect.see("Download PDF", { timeout: 15_000 });

    await page.locator("a[data-public-lang=es]").click();
    await expect.see("Descargar PDF", { timeout: 15_000 });
    expect.eq(await current(page, "es"), "true", "ES flips it back");
  }));
