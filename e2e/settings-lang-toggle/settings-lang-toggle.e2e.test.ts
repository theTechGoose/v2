/**
 * REQ-254 — demo issue onboarding-dashboard-settings-m2: "/settings half translated after EN/ES
 * toggle until reload". In a browser: open /settings in English, press the topbar's ES, and the
 * WHOLE page is Spanish at once — the hero line, the tabs, the Account card's labels and its
 * Language row — then EN brings it all back. No reload in between.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Lang Toggle Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
}

const text = (page: StoryTools["page"], selector: string) =>
  page.locator(selector).first().innerText().catch(() => "");

/** Click until `done` holds — a click before hydration is a no-op, so retry it (house clickUntil). */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).click({ timeout: 2_000 });
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

/** The toggle took: setLang mirrors the language onto <html lang> (P-65). */
const htmlLang = (page: StoryTools["page"], lang: string) => async () =>
  (await page.evaluate(() => document.documentElement.lang)) === lang;

async function snapshot(page: StoryTools["page"]) {
  return {
    hero: await text(page, ".hero__sub"),
    tabAccount: await text(page, "[data-cy='settings-tab-account']"),
    tabBilling: await text(page, "[data-cy='settings-tab-billing']"),
    account: await text(page, ".panel:has(.panel__title)"),
  };
}

Deno.test("REQ-254: on /settings the topbar EN/ES toggle flips the hero, the tabs and the Account card at once, without a reload", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.goto("/settings");
    await page.locator("[data-cy='settings-tab-account']").waitFor({
      timeout: 20_000,
    });

    const en = await snapshot(page);
    expect.eq(
      en.hero,
      "Update your business details below — changes save as you go.",
      "EN hero",
    );
    expect.eq(en.tabAccount, "Account", "EN Account tab");
    expect.eq(en.tabBilling, "Billing", "EN Billing tab");
    expect(en.account.includes("Language"), `EN Account card: ${en.account}`);
    expect(en.account.includes("English"), `EN Language row: ${en.account}`);

    // a marker on window survives only if the page is never reloaded
    await page.evaluate(() => {
      (globalThis as unknown as { __req254: boolean }).__req254 = true;
    });

    await clickUntil(
      page,
      "[data-cy='topbar-lang-es']",
      htmlLang(page, "es"),
    );
    // the lower form flipped before the fix too — wait for it, then the top must agree
    await expect.see("Idioma de la app");
    const es = await snapshot(page);
    expect.eq(
      es.hero,
      "Actualiza los datos de tu negocio abajo — se guardan al instante.",
      "ES hero",
    );
    expect.eq(es.tabBilling, "Facturación", "ES Billing tab");
    expect(
      es.account.includes("Idioma"),
      `ES Account card label: ${es.account}`,
    );
    expect(es.account.includes("Español"), `ES Language row: ${es.account}`);
    expect(
      !es.account.includes("English"),
      `ES Account card has no English left: ${es.account}`,
    );

    await clickUntil(
      page,
      "[data-cy='topbar-lang-en']",
      htmlLang(page, "en"),
    );
    await expect.see("App language");
    const back = await snapshot(page);
    expect.eq(back.hero, en.hero, "back to EN hero");
    expect(
      back.account.includes("English"),
      `back to EN Language row: ${back.account}`,
    );

    // the Billing tab follows the toggle too
    await clickUntil(
      page,
      "[data-cy='settings-tab-billing']",
      async () => (await page.locator("[data-cy='plan-current']").count()) > 0,
    );
    const billingEn = await text(page, "[data-cy='plan-pill']");
    await clickUntil(
      page,
      "[data-cy='topbar-lang-es']",
      htmlLang(page, "es"),
    );
    await page.waitForTimeout(300);
    const billingEs = await text(page, "[data-cy='plan-pill']");
    expect(
      billingEs !== billingEn,
      `the Billing tab's pill follows the toggle (EN "${billingEn}" → ES "${billingEs}")`,
    );

    expect.eq(
      await page.evaluate(() =>
        (globalThis as unknown as { __req254?: boolean }).__req254 === true
      ),
      true,
      "no reload happened",
    );
  }));
