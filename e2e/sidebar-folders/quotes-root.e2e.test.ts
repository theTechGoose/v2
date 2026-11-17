/**
 * REQ-773 — demo issue dv1-d1 (cycle dv1): testers asked "where is Quotes" — it sat inside the
 * Billing folder (REQ-176). Raphael: "I don't understand what quotes inside the billing folder
 * is ... Change that." On /dashboard, at 1280×800 and in the 390×844 phone drawer, Quotes is a
 * root row: one click, no folder opened, lands on /quotes. Invoices and Payments stay in Billing.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  await answerQuestions(http, auth, {
    name: "Quotes Root",
    businessName: "Quotes Root Co",
  });
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
}

Deno.test("REQ-773: on /dashboard Quotes is a root sidebar row at 1280×800 and in the 390×844 drawer — one click to /quotes, no folder opened; Billing keeps Invoices and Payments", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await signIn(http, page, baseUrl);
    const sb = page.locator("aside.sb");
    const nav = sb.locator(".sb__nav");
    const quotes = nav.locator("a.nav-item[href='/quotes']");
    const labels = async () =>
      (await nav.locator(".nav-item__label").allInnerTexts()).map((s) =>
        s.trim()
      );

    // 1. desktop, 1280×800
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/dashboard");
    await nav.locator(".nav-item__label", { hasText: "Customers" }).waitFor({
      timeout: 20_000,
    });
    expect(
      await nav.locator("[data-cy='nav-back']").count() === 0,
      "the dashboard's sidebar is at the root",
    );
    await quotes.waitFor({ state: "visible", timeout: 10_000 });
    const root = await labels();
    expect(
      root.indexOf("Quotes & agreements") === root.indexOf("Customers") + 1,
      `Quotes sits right after Customers on the root (${root.join(" | ")})`,
    );
    await page.screenshot({ path: `${folder}/dashboard-root-1280.png` });
    await quotes.click();
    await page.waitForURL(/\/quotes/, { timeout: 20_000 });
    await nav.locator("a.nav-item--active[href='/quotes']").waitFor({
      timeout: 20_000,
    });
    expect(
      await nav.locator("[data-cy='nav-back']").count() === 0,
      "on /quotes the sidebar rests at the root",
    );
    // Billing still holds Invoices and Payments
    await nav.locator("[data-cy='nav-folder-billing']").click();
    await nav.locator("[data-cy='nav-back']").waitFor({ timeout: 10_000 });
    expect.eq(
      (await labels()).join(" | "),
      "Back | Invoices | Payments | Work orders",
      "inside Billing",
    );

    // 2. phone, 390×844: ☰ opens the drawer at the root; Quotes is right there
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");
    const menu = page.locator("[data-cy='mobile-menu']");
    await menu.waitFor({ timeout: 20_000 });
    await nav.locator(".nav-item__label", { hasText: "Customers" }).waitFor({
      state: "attached",
      timeout: 20_000,
    });
    await menu.click();
    await quotes.waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(400); // the drawer slides (240 ms)
    expect(
      await nav.locator("[data-cy='nav-back']").count() === 0,
      "the drawer opens at the root",
    );
    await page.screenshot({ path: `${folder}/dashboard-drawer-390.png` });
    await quotes.click();
    await page.waitForURL(/\/quotes/, { timeout: 20_000 });
  }));
