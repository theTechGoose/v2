/**
 * REQ-414 — Raphael, 2026-11-12: "fix every issue the demo found, loop until
 * there are none." Demo-loop cycle 2, issue p4: "Landing and /login open in
 * Spanish for an English browser; /login has no language switch".
 *
 * A fresh English-locale visitor opens /login directly: it is Spanish-first
 * (product decision), and the EN | ES toggle above the card switches the
 * whole screen — heading and the phone form — to English, remembers the pick
 * for a plain revisit, and switches back.
 *
 * Copy pinned (lang/{en,es}.json): loginPage.heading "Welcome back" /
 * "Iniciar sesión", loginForm.submit "Text me a code" / "Enviar código".
 *
 * Page: front-end/routes/login.tsx (toggle island
 * front-end/islands/PublicLangToggle.tsx, the pick in front-end/lib/page-lang.ts).
 */
import { story, type StoryTools } from "#shots";

const current = (page: StoryTools["page"], lang: "en" | "es") =>
  page.locator(`a[data-public-lang=${lang}]`).getAttribute("aria-current");

Deno.test("REQ-414: /login has an EN | ES toggle that flips the screen to English, remembers it, and flips back", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/login");
    await expect.see("Iniciar sesión", { timeout: 15_000 });
    expect.eq(await current(page, "es"), "true", "ES is the current language");

    await page.locator("a[data-public-lang=en]").click();
    await expect.see("Welcome back", { timeout: 15_000 });
    await expect.see("Text me a code", { timeout: 15_000 });
    expect.eq(await current(page, "en"), "true", "EN is now current");
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "<html lang> follows",
    );

    // A plain visit (no ?lang=) now opens English — the pick was persisted.
    await page.goto("/login");
    await expect.see("Welcome back", { timeout: 15_000 });
    await expect.see("Text me a code", { timeout: 15_000 });

    await page.locator("a[data-public-lang=es]").click();
    await expect.see("Iniciar sesión", { timeout: 15_000 });
    await expect.see("Enviar código", { timeout: 15_000 });
    expect.eq(await current(page, "es"), "true", "ES flips it back");
  }));
