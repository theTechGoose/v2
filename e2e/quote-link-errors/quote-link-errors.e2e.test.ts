/**
 * REQ-574 (demo-loop cycle 4, issue p4-p9b) — /q/<id> says what actually
 * went wrong. A link that never existed (a truncated or unknown id → 404)
 * used to read "This quote link expired or was revoked." in English for
 * everyone; a network failure read the same.
 *
 *   - unknown id            → "We can't find this quote — check the link."
 *   - no doc, Spanish browser (Accept-Language: es) → the Spanish copy
 *   - the fetch fails       → "Couldn't load this quote…" + Retry, and Retry
 *                             fetches again
 */
import { story } from "#shots";

const NOT_FOUND_EN = "We can't find this quote — check the link.";
const NOT_FOUND_ES = "No encontramos esta cotización — revisa el enlace.";
const EXPIRED_EN = "This quote link expired or was revoked.";
const LOAD_FAILED_EN = "Couldn't load this quote.";

/** wait (up to 15 s) until the page's body text contains `text` */
async function waitForText(
  page: { locator(s: string): { innerText(): Promise<string> } },
  text: string,
): Promise<string> {
  let body = "";
  for (let i = 0; i < 75; i++) {
    body = await page.locator("body").innerText().catch(() => "");
    if (body.includes(text)) return body;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `never saw ${JSON.stringify(text)}; body:\n${body.slice(0, 600)}`,
  );
}

Deno.test("REQ-574 (p4-p9b): /q/<unknown id> says the quote can't be found, not that it expired", (t) =>
  story(t, async ({ page, expect }) => {
    await page.goto("/q/f4c5559b");
    const body = await waitForText(page, NOT_FOUND_EN);
    expect.eq(
      body.includes(EXPIRED_EN),
      false,
      "no 'expired or revoked' for a link that never existed",
    );
  }));

Deno.test("REQ-574 (p4-p9b): with no document, the not-found card speaks the browser's Accept-Language", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setExtraHTTPHeaders({ "accept-language": "es-MX,es;q=0.9" });
    await page.goto("/q/f4c5559b");
    const body = await waitForText(page, NOT_FOUND_ES);
    expect.eq(body.includes(NOT_FOUND_EN), false, "not the English copy");
  }));

Deno.test("REQ-574 (p4-p9b): a failed fetch says couldn't load and Retry fetches again", (t) =>
  story(t, async ({ page, expect }) => {
    let calls = 0;
    await page.route("**/api/quotes/*/public*", async (route) => {
      calls++;
      if (calls === 1) await route.abort("failed");
      else await route.continue();
    });
    await page.goto("/q/f4c5559b");
    const body = await waitForText(page, LOAD_FAILED_EN);
    expect.eq(
      body.includes(EXPIRED_EN),
      false,
      "a network failure is not 'expired'",
    );
    const retry = page.locator("[data-cy='quote-retry']");
    for (let i = 0; i < 10 && calls < 2; i++) {
      await retry.click({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
    await waitForText(page, NOT_FOUND_EN);
    expect.eq(calls >= 2, true, "Retry fetched the quote again");
  }));
