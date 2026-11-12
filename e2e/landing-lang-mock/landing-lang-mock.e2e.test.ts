/**
 * REQ-345 — demo-loop cycle 1, demo issues m3 + p15-6 (demo-report r20a1d9c2):
 * "phone mock-up stays Spanish on /?lang=en" and "landing hero mock in English
 * on the Spanish page".
 *
 * The landing page "/" has two phone mocks: the hero's static `hs-phone` chat
 * (front-end/routes/index.tsx, data-i18n from lib/landing-dict.ts) and the
 * PhoneChat island (front-end/islands/PhoneChat.tsx, langSignal). The EN/ES
 * toggle is a plain script (static/landing-scripts.js) — it must flip BOTH
 * without a reload, and a Spanish page must show Spanish input bubbles.
 */
import { story, type StoryTools } from "#shots";

const DESKTOP = { width: 1280, height: 900 };
const EN_ISLAND_FIRST = "Kitchen remodel for the Hernández family";
const ES_ISLAND_FIRST = "Remodelación cocina para los Hernández";
const EN_HERO_FIRST = "Kitchen remodel for the Hernández family";
const ES_HERO_FIRST_RE = /Remodelaci[oó]n/;

const heroFirstBubble = (page: StoryTools["page"]) =>
  page.locator(".hs-phone .hs-bubble--me").first();
const islandFirstBubble = (page: StoryTools["page"]) =>
  page.locator(".phone .chat-body .bubble.me").first();

Deno.test("REQ-345 p15-6: /?lang=es shows Spanish input bubbles in the hero mock and the island", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/?lang=es");
    await heroFirstBubble(page).waitFor({ state: "visible" });
    const hero = (await heroFirstBubble(page).textContent()) ?? "";
    expect(
      ES_HERO_FIRST_RE.test(hero),
      `the hero mock's first bubble is Spanish (got "${hero.trim()}")`,
    );
    expect(
      !hero.includes(EN_HERO_FIRST),
      "the hero mock's first bubble is not the English copy",
    );
    const cta = page.locator(".hs-phone .hs-rich__cta").first();
    expect.eq(
      ((await cta.textContent()) ?? "").trim(),
      "Enviar al cliente →",
      "the mock's send CTA is Spanish",
    );
    await islandFirstBubble(page).waitFor({ state: "attached" });
    const island = (await islandFirstBubble(page).textContent()) ?? "";
    expect(
      island.includes(ES_ISLAND_FIRST),
      `the PhoneChat island's first bubble is Spanish (got "${island.trim()}")`,
    );
  }));

Deno.test("REQ-345 m3: clicking EN on / flips both mocks to English without a reload", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/?lang=es");
    await islandFirstBubble(page).waitFor({ state: "attached" });
    // A marker that only survives if the document is NOT reloaded.
    await page.evaluate(() => {
      (globalThis as { __pmNoReload?: number }).__pmNoReload = 1;
    });
    await page.locator('.lang-toggle button[data-lang="en"]').click();
    await page.waitForFunction(
      (en) =>
        document.querySelector(".phone .chat-body .bubble.me")?.textContent
          ?.includes(en) === true,
      EN_ISLAND_FIRST,
      { timeout: 10_000 },
    ).catch(() => {});
    const island = (await islandFirstBubble(page).textContent()) ?? "";
    expect(
      island.includes(EN_ISLAND_FIRST),
      `the PhoneChat island's first bubble is English after the toggle (got "${island.trim()}")`,
    );
    const hero = (await heroFirstBubble(page).textContent()) ?? "";
    expect(
      hero.includes(EN_HERO_FIRST),
      `the hero mock's first bubble is English after the toggle (got "${hero.trim()}")`,
    );
    expect.eq(
      await page.evaluate(() =>
        (globalThis as { __pmNoReload?: number }).__pmNoReload
      ),
      1,
      "the page was not reloaded",
    );
    expect.eq(
      await page.evaluate(() =>
        new URL(location.href).searchParams.get("lang")
      ),
      "en",
      "the URL reads ?lang=en",
    );
  }));

Deno.test("REQ-413 p5 / m49: the landing's aria-labels and hero lead follow the EN/ES toggle", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/?lang=es");
    const aria = (sel: string) =>
      page.locator(sel).first().getAttribute("aria-label");
    await page.locator(".lang-toggle").first().waitFor({ state: "attached" });
    expect.eq(await aria(".lang-toggle"), "Idioma", "es: the tablist label");
    expect.eq(
      await aria(".pm-steps"),
      "Pasos para entrar",
      "es: the sign-in steps label",
    );
    await page.locator('.lang-toggle button[data-lang="en"]').click();
    await page.waitForFunction(
      () =>
        document.querySelector(".lang-toggle")?.getAttribute("aria-label") ===
          "Language",
      undefined,
      { timeout: 10_000 },
    ).catch(() => {});
    expect.eq(await aria(".lang-toggle"), "Language", "en: the tablist label");
    expect.eq(
      await aria(".pm-steps"),
      "Sign-in steps",
      "en: the sign-in steps label",
    );
    const lead =
      (await page.locator('[data-i18n="hero.lead"]').first().textContent()) ??
        "";
    expect(
      lead.startsWith("Talk to us in English or Spanish."),
      `en: the hero lead is written for an English reader (got "${lead.trim()}")`,
    );
  }));
