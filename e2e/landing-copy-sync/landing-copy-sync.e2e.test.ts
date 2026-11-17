/**
 * REQ-742 — demo-loop cycle 5 (run r37f88707), demo issue p18-6e
 * "Landing title and hero differ": the tab title must say what the hero says,
 * and the hero document card and the Quote showcase must name the $1,950
 * labour line the same way — on first paint and after the EN/ES toggle.
 */
import { story, type StoryTools } from "#shots";

const DESKTOP = { width: 1280, height: 900 };

async function check(
  page: StoryTools["page"],
  expect: StoryTools["expect"],
  lang: "en" | "es",
) {
  await page.waitForFunction(
    (l) => document.documentElement.getAttribute("lang") === l,
    lang,
    { timeout: 10_000 },
  );
  const h1 = ((await page.locator('[data-i18n="hero.h1Sr"]').first()
    .textContent()) ?? "").trim();
  expect.eq(await page.title(), `DocuMonster — ${h1}`, `${lang}: title = hero`);
  const heroLabor = ((await page.locator('[data-i18n="doc.q.l3"]').first()
    .textContent()) ?? "").trim();
  const name = heroLabor.replace(/\s*\([^)]*\)\s*$/, "");
  const showcase = ((await page.locator("#doc-lines .doc-line .desc").nth(3)
    .textContent()) ?? "").trim();
  expect.eq(showcase, name, `${lang}: showcase labour row = hero card's`);
}

Deno.test("REQ-742 p18-6e: / title matches the hero and the labour line has one name, en + es", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/?lang=es");
    await page.locator("#doc-lines .doc-line").first().waitFor({
      state: "attached",
    });
    await check(page, expect, "es");
    await page.locator('.lang-toggle button[data-lang="en"]').click();
    await check(page, expect, "en");
  }));
