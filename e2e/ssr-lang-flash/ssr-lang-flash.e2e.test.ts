/**
 * REQ-231 — demo issues quote-invoice-money-m11 ("Spanish composer placeholder
 * 'Ej: El cliente quiere una losa…' shown in the English UI") and
 * stage-content-m2 ("Stage shows Spanish for a moment after loading", ES
 * pressed). RCA ssr-lang-flash.
 *
 * The server rendered every island in langSignal's Spanish default, so until
 * the islands hydrate an English user's page reads Spanish: the composer's
 * placeholder, ES pressed in the topbar. On the demo stage the replica frame
 * sat on that server markup for ~20 s. The first two stories hold the page on
 * its server markup (no island script loads — a slow hydration, frozen) and
 * read it; the last checks the hydrated page ends up English too.
 *
 * Pages: front-end/routes/assistant/index.tsx (islands AsstChat, DashTopbar),
 * the language plumbing front-end/lib/lang.ts + front-end/lib/ssr-lang.ts.
 */
import { story, type StoryTools } from "#shots";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };
const EN_PLACEHOLDER =
  "Ex: Customer wants a 10'x10' slab, what should I charge?";

/** An English-speaking contractor signed in on the page's browser context. */
async function signInEnglish(
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
  const me = await http("/api/me", {
    method: "PUT",
    headers: { ...JSON_HEADERS, cookie },
    body: JSON.stringify({ name: "Flash User", language: "en" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  // No pm_lang cookie: the account's own language is the only signal.
  await page.context().addCookies([{ name, value, domain: host, path: "/" }]);
}

/** Keep the page on its server-rendered markup: no script file loads, so no
 *  island hydrates (inline scripts in the HTML still run). */
async function freezeBeforeHydration(page: StoryTools["page"]) {
  await page.route(
    "**/*",
    (route) =>
      route.request().resourceType() === "script"
        ? route.abort()
        : route.continue(),
  );
}

const composer = (page: StoryTools["page"]) =>
  page.locator(".chat textarea.composer__input").last();

Deno.test("REQ-231 m11: before hydration, an English user's composer placeholder is already English", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signInEnglish(http, page, baseUrl);
    await freezeBeforeHydration(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    await composer(page).waitFor({ state: "attached" });
    const ph = await composer(page).getAttribute("placeholder");
    expect.eq(
      ph,
      EN_PLACEHOLDER,
      "the server-rendered composer placeholder is English",
    );
  }));

Deno.test("REQ-231 m2: before hydration, the topbar has EN pressed, not ES", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signInEnglish(http, page, baseUrl);
    await freezeBeforeHydration(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    const en = page.locator('[data-cy="topbar-lang-en"]');
    const es = page.locator('[data-cy="topbar-lang-es"]');
    await en.waitFor({ state: "attached" });
    expect(
      (await en.getAttribute("class"))?.includes("topbar__lang-btn--on") ===
        true,
      `EN is the pressed language (EN class: "${await en.getAttribute(
        "class",
      )}")`,
    );
    expect(
      (await es.getAttribute("class"))?.includes("topbar__lang-btn--on") ===
        false,
      "ES is not pressed",
    );
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "<html lang> is English",
    );
  }));

Deno.test("REQ-231: after hydration the English user's composer placeholder is still English", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signInEnglish(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    await composer(page).waitFor({ state: "visible" });
    await page.waitForFunction(
      (en) =>
        document.querySelector(".chat textarea.composer__input")
          ?.getAttribute("placeholder") === en,
      EN_PLACEHOLDER,
      { timeout: 10_000 },
    ).catch(() => {});
    expect.eq(
      await composer(page).getAttribute("placeholder"),
      EN_PLACEHOLDER,
      "the composer placeholder is English",
    );
  }));
