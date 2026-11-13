/**
 * REQ-715 — demo-loop cycle 5, issue m31 "No per-client language" (with
 * c2-M29, c3-m43, c4-M34). Pair 6: "¿cómo le digo que Carmen habla español?
 * No veo campo de idioma del cliente." — the New customer dialog and the card
 * had no language, so every send had to be re-picked by hand.
 *
 *  1. /customers → New customer: "Customer's language" → Español is saved
 *     on the customer.
 *  2. Her card shows the language and changes it in place.
 *  3. /quotes?open=<her quote> → Send ▾ → Email: "Sends in" starts on
 *     Español, and the send goes out in Spanish (the quote records it).
 *  4. A visitor with no cookies opens her quote's bare /q link (no ?lang=):
 *     the contract opens in Español, her language (English first otherwise,
 *     REQ-048).
 *
 * Pages: /customers (ClientsPage.tsx + ClientsBoard.tsx), /quotes
 * (QuotesPage.tsx + components/QuoteSendDialog.tsx), /q (PublicQuoteView).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
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
  if (!cookie) throw new Error(`sign-in: no session (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Luis Ortega", language: "en" }],
      ["/api/profile/identity", { businessName: "Ortega Handyman Services" }],
    ] as const
  ) {
    const res = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(payload),
    });
    await res.body?.cancel();
  }
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
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

type CustomerRow = { id: string; name: string; language?: string };

/** the customer's stored language, once it reads `want` (polls the API) */
async function languageOf(
  http: StoryTools["http"],
  auth: Record<string, string>,
  name: string,
  want: string | undefined,
): Promise<CustomerRow | undefined> {
  let row: CustomerRow | undefined;
  for (let i = 0; i < 25; i++) {
    const r = await http("/api/customers", { headers: auth });
    const list = (await r.json()) as CustomerRow[];
    row = list.find((c) => c.name === name);
    if (row && row.language === want) return row;
    await new Promise((res) => setTimeout(res, 200));
  }
  return row;
}

Deno.test("REQ-715 m31: a customer saved as Spanish-speaking keeps it — the card shows and changes it, her quote's send dialog starts on Español, and her bare /q link opens in Spanish", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });

    // 1 — New customer with a language
    await page.goto("/customers");
    const modal = page.locator("form").filter({ hasText: "New customer" });
    await clickUntil(
      page,
      "button.ph2__cta",
      async () => (await modal.count()) > 0,
    );
    const language = modal.locator("[data-cy='cf-language']");
    expect.eq(
      await language.count(),
      1,
      "the New customer form has a language field",
    );
    await expect.see("Customer's language");
    await modal.locator("input").first().fill("Carmen Núñez");
    await modal.locator("input[type='email']").fill(
      "carmen@blackhole.postmarkapp.com",
    );
    await language.selectOption("es");
    await modal.locator("button[type='submit']").click();
    // the durable result — her card on the board (the "added" toast lives
    // 4 s, less than one stamped frame takes on a loaded machine)
    await expect.see("Carmen Núñez");
    const saved = await languageOf(http, auth, "Carmen Núñez", "es");
    expect.eq(
      saved?.language,
      "es",
      "the customer is saved as Spanish-speaking",
    );
    const id = saved!.id;

    // 2 — the card shows it and changes it in place
    const card = page.locator(`.ccard2[data-customer-id='${id}']`);
    await card.waitFor({ state: "visible", timeout: 15_000 });
    const row = card.locator("[data-cy='ccard2-row-language'] select");
    await clickUntil(
      page,
      `.ccard2[data-customer-id='${id}'] .ccard2__name`,
      async () =>
        (await card.getAttribute("class"))?.includes("ccard2--open") ?? false,
    );
    await row.waitFor({ state: "visible", timeout: 10_000 });
    expect.eq(await row.inputValue(), "es", "the card shows Español");
    await row.selectOption("en");
    expect.eq(
      (await languageOf(http, auth, "Carmen Núñez", "en"))?.language,
      "en",
      "the card saves a change of language",
    );
    await row.selectOption("es");
    expect.eq(
      (await languageOf(http, auth, "Carmen Núñez", "es"))?.language,
      "es",
      "and back to Español",
    );

    // 3 — her quote's send dialog starts on Español, and goes out in it
    const created = await http("/api/quotes", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: id,
        summary: "Faucet repair — Carmen Núñez",
        jobName: "Faucet Repair",
        lineItems: [{
          description: "Faucet repair",
          quantity: 1,
          unit: "job",
          price: 45000,
        }],
        estimatedTotal: 45000,
        status: "draft",
      }),
    });
    const quote = await created.json();
    const sent = await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        status: "sent",
        sentAt: new Date().toISOString(),
      }),
    });
    await sent.body?.cancel();

    await page.goto(`/quotes?open=${quote.id}`);
    await page.locator("[data-cy='quote-open-panel']").waitFor({
      timeout: 15_000,
    });
    const menu = page.locator("[data-cy='quote-panel-send-menu']");
    await clickUntil(
      page,
      "[data-cy='quote-panel-send']",
      async () => (await menu.count()) > 0,
    );
    await page.locator("[data-cy='quote-panel-send-email']").click();
    const dialog = page.locator("[data-cy='send-dialog']");
    await dialog.waitFor({ state: "visible", timeout: 5_000 });
    expect.eq(
      await page.locator("[data-cy='send-lang-es']").getAttribute(
        "aria-pressed",
      ),
      "true",
      "'Sends in' starts on Español — her language",
    );
    expect.eq(
      await page.locator("[data-cy='send-lang-en']").getAttribute(
        "aria-pressed",
      ),
      "false",
      "English is not the pick",
    );

    await page.locator("[data-cy='send-keep']").click();
    await page.locator("[data-cy='quote-panel-send-result']").waitFor({
      state: "visible",
      timeout: 20_000,
    });
    let lang: string | undefined;
    for (let i = 0; i < 25 && lang !== "es"; i++) {
      const q = await http(`/api/quotes/${quote.id}`, { headers: auth });
      lang = (await q.json())?.lastDelivery?.lang;
      if (lang !== "es") await new Promise((res) => setTimeout(res, 200));
    }
    expect.eq(lang, "es", "the quote went out in Spanish");

    // 4 — her bare /q link, opened by a visitor with no language pick
    await page.context().clearCookies();
    await page.goto(`/q/${quote.id}`);
    const esPressed = page.locator(
      "[data-contract-lang='es'][aria-pressed='true']",
    );
    await esPressed.waitFor({ state: "visible", timeout: 15_000 });
    expect.eq(
      await esPressed.count(),
      1,
      "the contract opens in Español — her language — with no ?lang=",
    );
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "es",
      "<html lang> follows",
    );
  }));
