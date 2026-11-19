/**
 * REQ-1146 (LOOP-007 q3, q3-77) — Browser Back steps back through the customer page's tabs.
 * Open /customers, then her page; click Invoices, then Payments. Back shows Invoices
 * (?tab=invoices, its tab selected), Back again shows Overview (no ?tab=), and only a third
 * Back leaves her page for /customers. Today each tab click REPLACES the history entry, so the
 * first Back already leaves the customer page.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
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
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Tab Back Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return auth;
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

/** where the page is and which tab it shows, read in one round trip */
async function where(page: StoryTools["page"]) {
  return await page.evaluate(() => ({
    path: location.pathname,
    tab: new URLSearchParams(location.search).get("tab"),
    selected: document.querySelector("[data-cy^='cws-tab-'][aria-selected='true']")?.getAttribute("data-cy") ?? null,
  }));
}

Deno.test("REQ-1146 (LOOP-007 q3, q3-77): browser Back steps back through the customer tabs (Payments → Invoices → Overview) before leaving her page", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const r = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: `Tab Back ${digits()}` }),
    });
    const ana = await r.json();
    if (!r.ok) throw new Error(`POST /api/customers → ${r.status} ${JSON.stringify(ana)}`);

    // an earlier page in history, then her page on Overview
    await page.goto("/customers");
    await page.goto(`/customers/${ana.id}`);
    await page.locator(`[data-cy='customer-workspace'][data-customer='${ana.id}']`).waitFor({ timeout: 20_000 });
    await page.locator("[data-cy='cws-tab-overview'][aria-selected='true']").waitFor({ timeout: 20_000 });

    // Invoices, then Payments
    await clickUntil(page, "[data-cy='cws-tab-invoices']", async () =>
      (await where(page)).selected === "cws-tab-invoices");
    await clickUntil(page, "[data-cy='cws-tab-payments']", async () =>
      (await where(page)).selected === "cws-tab-payments");
    const onPayments = await where(page);
    expect.eq(onPayments.tab, "payments", "the URL says ?tab=payments");

    // Back #1 → Invoices, still on her page
    await page.goBack({ waitUntil: "commit", timeout: 20_000 }).catch(() => null);
    await page.waitForTimeout(1_000);
    const back1 = await where(page);
    expect.eq(back1.path, `/customers/${ana.id}`, `Back from Payments stays on her page (went to ${back1.path})`);
    expect.eq(back1.tab, "invoices", "Back from Payments → ?tab=invoices");
    await page.locator("[data-cy='cws-tab-invoices'][aria-selected='true']").waitFor({ timeout: 10_000 });

    // Back #2 → Overview, no ?tab=
    await page.goBack({ waitUntil: "commit", timeout: 20_000 }).catch(() => null);
    await page.waitForTimeout(1_000);
    const back2 = await where(page);
    expect.eq(back2.path, `/customers/${ana.id}`, `Back from Invoices stays on her page (went to ${back2.path})`);
    expect.eq(back2.tab, null, "Back from Invoices → no ?tab= param");
    await page.locator("[data-cy='cws-tab-overview'][aria-selected='true']").waitFor({ timeout: 10_000 });

    // Back #3 → leaves her page for /customers
    await page.goBack({ waitUntil: "commit", timeout: 20_000 });
    await page.waitForURL((u) => u.pathname === "/customers", { timeout: 20_000 });
  }));
