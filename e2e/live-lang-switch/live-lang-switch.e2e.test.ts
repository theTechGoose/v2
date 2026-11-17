/**
 * REQ-367 — demo-loop cycle 1, issue m10: "Text left in the other language after an EN/ES switch
 * (footer, tab title, old cards, relative times)". Pair 6 flipped /customers to EN without a
 * reload and read a Spanish footer ("Términos de servicio"), the tab "Clientes · DocuMonster" and
 * the card "New customer — added hace un momento."; on the public contract the footer kept its
 * language through the contract's own EN | ES. In a browser, no reload in between, everything
 * follows the switch — both ways.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
type Page = StoryTools["page"];

async function signInSpanish(
  http: StoryTools["http"],
  page: Page,
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
    body: JSON.stringify({ language: "es", name: "Luis Live Lang" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]),
  );
  return { auth };
}

const text = (page: Page, selector: string) =>
  page.locator(selector).first().innerText().catch(() => "");

/** Click until `done` holds — a click before hydration is a no-op, so retry it (house clickUntil). */
async function clickUntil(
  page: Page,
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

/** wait (up to 10 s) for `fn` to hold; false when it never did */
async function settles(page: Page, fn: () => Promise<boolean>) {
  for (let i = 0; i < 50; i++) {
    if (await fn()) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

const footerTerms = (page: Page) =>
  text(page, "[data-site-footer] [data-legal-link='terms']");

/** a marker on window survives only if the page is never reloaded */
const markWindow = (page: Page) =>
  page.evaluate(() => {
    (globalThis as unknown as { __req367: boolean }).__req367 = true;
  });
const stillSameWindow = (page: Page) =>
  page.evaluate(() =>
    (globalThis as unknown as { __req367?: boolean }).__req367 === true
  );

Deno.test("REQ-367: on /customers the topbar EN/ES switch flips the footer, the tab title and the card's 'added …' at once, without a reload", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signInSpanish(http, page, baseUrl);
    const r = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "María José Peña",
        email: "mjpena@blackhole.postmarkapp.com",
      }),
    });
    expect(r.ok, `customer created (${r.status})`);
    await r.body?.cancel();

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/customers");
    await expect.see("María José Peña");
    await page.locator(".ccard2__story").first().waitFor({ timeout: 20_000 });
    await markWindow(page);

    // Spanish, as served
    expect.eq(await footerTerms(page), "Términos de servicio", "ES footer");
    expect.eq(await page.title(), "Clientes · DocuMonster", "ES tab title");
    const storyEs = await text(page, ".ccard2__story");
    expect(
      /^Cliente nuevo — agregado hace (un momento|\d+ min)\.$/.test(storyEs),
      `ES story (${storyEs})`,
    );

    // EN in the topbar
    await clickUntil(
      page,
      "[data-cy='topbar-lang-en']",
      async () =>
        (await page.evaluate(() => document.documentElement.lang)) === "en",
    );
    const footerFlipped = await settles(
      page,
      async () => (await footerTerms(page)) === "Terms of Service",
    );
    expect(
      footerFlipped,
      `the footer follows EN (still "${await footerTerms(page)}")`,
    );
    const titleFlipped = await settles(
      page,
      async () => (await page.title()) === "Customers · DocuMonster",
    );
    expect(titleFlipped, `the tab title follows EN ("${await page.title()}")`);
    const storyEn = await text(page, ".ccard2__story");
    expect(
      /^New customer — added (just now|\d+m ago)\.$/.test(storyEn),
      `EN story in one language (${storyEn})`,
    );
    const cardEn = await text(page, ".ccard2");
    expect(
      !/\bhace\b|agregado/.test(cardEn),
      `no Spanish left on the EN card (${cardEn})`,
    );

    // and back to ES
    await clickUntil(
      page,
      "[data-cy='topbar-lang-es']",
      async () =>
        (await page.evaluate(() => document.documentElement.lang)) === "es",
    );
    expect(
      await settles(
        page,
        async () => (await footerTerms(page)) === "Términos de servicio",
      ),
      `the footer follows ES back ("${await footerTerms(page)}")`,
    );
    expect(
      await settles(
        page,
        async () => (await page.title()) === "Clientes · DocuMonster",
      ),
      `the tab title follows ES back ("${await page.title()}")`,
    );
    const storyBack = await text(page, ".ccard2__story");
    expect(
      /^Cliente nuevo — agregado hace (un momento|\d+ min)\.$/.test(storyBack),
      `ES story again (${storyBack})`,
    );
    expect(await stillSameWindow(page), "no reload in between");
  }));

Deno.test("REQ-367: a customer with no saved language opens a contract link in English; its EN | ES switch flips the footer, the tab title and <html lang>", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // an unknown link still renders the switch above its "link expired" card
    await page.goto("/q/req367-no-such-quote");
    const es = page.locator("[data-contract-lang='es']");
    await es.waitFor({ timeout: 20_000 });
    await markWindow(page);
    expect.eq(
      await footerTerms(page),
      "Terms of Service",
      "English first (REQ-048)",
    );
    expect.eq(
      await page.title(),
      "Quote + Agreement · DocuMonster",
      "EN tab title",
    );

    await clickUntil(
      page,
      "[data-contract-lang='es']",
      async () => (await es.getAttribute("aria-pressed")) === "true",
    );
    expect(
      await settles(
        page,
        async () => (await footerTerms(page)) === "Términos de servicio",
      ),
      `the footer follows the contract's ES ("${await footerTerms(page)}")`,
    );
    expect.eq(
      await page.title(),
      "Cotización + Acuerdo · DocuMonster",
      "ES tab title",
    );
    expect(
      await settles(
        page,
        async () =>
          (await page.evaluate(() => document.documentElement.lang)) === "es",
      ),
      "<html lang> follows to es",
    );

    await clickUntil(
      page,
      "[data-contract-lang='en']",
      async () =>
        (await page.locator("[data-contract-lang='en']").getAttribute(
          "aria-pressed",
        )) === "true",
    );
    expect(
      await settles(
        page,
        async () => (await footerTerms(page)) === "Terms of Service",
      ),
      `the footer follows back to EN ("${await footerTerms(page)}")`,
    );
    expect.eq(
      await page.title(),
      "Quote + Agreement · DocuMonster",
      "EN tab title again",
    );
    expect(await stillSameWindow(page), "no reload in between");
  }));
