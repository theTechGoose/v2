/**
 * REQ-048 — Raphael, 2026-09-30: "the contract should be english first and
 * then there should be a toggle to turn the contract to spanish in real time.
 * should be easy to view in whatever language you want."
 *
 * The contractor here sends in SPANISH (commsLanguage es) — the case where
 * the old /q fell back to a Spanish document. The customer opens the link
 * with no language cookie at all.
 *
 * Copy pinned (lang/{en,es}.json): quoteDoc.contractValue "Agreement value" /
 * "Valor del acuerdo"; quoteDoc.terms "Terms" / "Términos".
 *
 * Page: front-end/routes/q/[id].tsx (island front-end/islands/PublicQuoteView.tsx,
 * the pick in shared/quote-flow/public-lang.ts).
 */
import { story, type StoryTools } from "#shots";

const PHONE = "+15125550947";
const JSON_HEADERS = { "content-type": "application/json" };

/** A Spanish-sending contractor with one quote; returns the quote id. The
 *  page's own browser context stays cookie-less: the customer's view. */
async function seedQuote(http: StoryTools["http"]): Promise<string> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: PHONE, code: "000000" }),
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
  await post("/api/me", { name: "Toggle User", language: "es" }, "PUT");
  await post("/api/profile/identity", {
    businessName: "Toggle ES LLC",
    commsLanguage: "es",
  }, "PUT");
  const customer = await post("/api/customers", {
    name: "Lucía Ortega",
    phoneNumber: "+15125550950",
  });
  const quote = await post("/api/quotes", {
    customerId: customer.id,
    summary: "Pintura interior",
    jobName: "Pintura interior",
    lineItems: [{
      description: "Pintura",
      quantity: 1,
      unit: "job",
      price: 120000,
    }],
    estimatedTotal: 120000,
    terms: [{
      stepId: "payment_terms",
      label: "Payment terms",
      value: "50 / 50",
    }],
  });
  return quote.id as string;
}

const bodyText = (page: StoryTools["page"]) => page.locator("body").innerText();
const pressed = (page: StoryTools["page"], lang: "en" | "es") =>
  page.locator(`button[data-contract-lang=${lang}]`).getAttribute(
    "aria-pressed",
  );

Deno.test("REQ-048: the contract opens in English even when the contractor's comms language is Spanish", (t) =>
  story(t, async ({ page, expect, http }) => {
    const quoteId = await seedQuote(http);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/q/${quoteId}`);
    await expect.see("Agreement value", { timeout: 15_000 });
    expect(
      !(await bodyText(page)).includes("Valor del acuerdo"),
      "nothing on the page is in Spanish",
    );
    expect.eq(await pressed(page, "en"), "true", "the EN toggle is pressed");
    expect.eq(await pressed(page, "es"), "false", "the ES toggle is not");
  }));

Deno.test("REQ-048: the ES toggle flips the whole contract to Spanish in place, without a reload", (t) =>
  story(t, async ({ page, expect, http }) => {
    const quoteId = await seedQuote(http);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/q/${quoteId}`);
    await expect.see("Agreement value", { timeout: 15_000 });
    // A marker on the window survives only if the page is NOT reloaded.
    await page.evaluate(() => {
      (globalThis as unknown as { __pmSamePage: boolean }).__pmSamePage = true;
    });
    await page.locator("button[data-contract-lang=es]").click();
    await expect.see("Valor del acuerdo");
    await expect.see("Términos");
    expect(
      !(await bodyText(page)).includes("Agreement value"),
      "no English left on the page",
    );
    expect.eq(
      await page.evaluate(() =>
        (globalThis as unknown as { __pmSamePage?: boolean }).__pmSamePage
      ),
      true,
      "the page was not reloaded",
    );
    expect.eq(await pressed(page, "es"), "true", "the ES toggle is pressed");
    expect.eq(
      new URL(page.url()).search,
      "?lang=es",
      "the link carries the pick",
    );
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "es",
      "<html lang> follows",
    );
    expect(
      /Cotización/.test(await page.title()),
      `the tab title follows (${await page.title()})`,
    );
  }));

Deno.test("REQ-048: the pick is remembered across a reload and EN flips it back", (t) =>
  story(t, async ({ page, expect, http }) => {
    const quoteId = await seedQuote(http);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/q/${quoteId}`);
    await expect.see("Agreement value", { timeout: 15_000 });
    await page.locator("button[data-contract-lang=es]").click();
    await expect.see("Valor del acuerdo");
    // A plain visit (no ?lang=) now opens Spanish — the pick was persisted.
    await page.goto(`/q/${quoteId}`);
    await expect.see("Valor del acuerdo", { timeout: 15_000 });
    await page.locator("button[data-contract-lang=en]").click();
    await expect.see("Agreement value");
    expect(
      !(await bodyText(page)).includes("Valor del acuerdo"),
      "no Spanish left on the page",
    );
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "<html lang> is back to English",
    );
  }));
