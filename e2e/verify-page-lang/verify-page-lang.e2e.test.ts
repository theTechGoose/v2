/**
 * REQ-590 — Raphael: "fix every issue the demo found, loop until there are none." Demo-loop
 * cycle 4 (run r857a9d67), issues M33 and p4-p6d (fleet-5: "on Check your phone click ES
 * (URL lang=es) … /welcome came up in English").
 *
 * In a browser: a sign-up sent from the ENGLISH landing reaches /verify in English with the dev
 * code's popup; ES on /verify's own EN | ES toggle reloads the page in Spanish and the popup is
 * still there (p4-p6d); "Use this code" signs the new account in and /welcome speaks Spanish with
 * ES pressed (M33) — the account was born in the language picked on the code page.
 *
 * Pages: /landing → /verify (islands/CodeInput.tsx, islands/PublicLangToggle.tsx) → /welcome.
 */
import { story } from "#shots";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const DESKTOP = { width: 1280, height: 900 };

Deno.test("REQ-590: an English-landing sign-up that picks ES on /verify keeps the dev code and meets a Spanish /welcome (demo M33, p4-p6d)", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);

    await page.goto("/landing?lang=en");
    await page.locator("#trial-phone").fill(`512${digits()}`);
    await page.locator("#trial-phone").evaluate((el: HTMLInputElement) =>
      el.form!.requestSubmit()
    );
    await page.waitForURL((u: URL) => u.pathname === "/verify", {
      timeout: 60_000,
    });
    const popup = page.locator("[data-cy='dev-code']");
    await popup.waitFor({ state: "visible", timeout: 15_000 });
    const before = (await popup.locator("[data-cy='dev-code-value']")
      .textContent() ?? "").trim();

    // ES on the code page's own toggle — a full-page navigation to ?lang=es
    await page.locator("[data-cy='public-lang-toggle'] a[hreflang='es']")
      .click();
    await page.waitForURL(
      (u: URL) =>
        u.pathname === "/verify" && u.searchParams.get("lang") === "es",
      { timeout: 30_000 },
    );
    try {
      await popup.waitFor({ state: "visible", timeout: 15_000 });
    } catch {
      throw new Error(
        "p4-p6d: after ES on /verify the dev-code popup is gone",
      );
    }
    expect.eq(
      (await popup.locator("[data-cy='dev-code-value']").textContent() ?? "")
        .trim(),
      before,
      "the same code is still offered after the toggle",
    );

    await popup.locator("[data-cy='dev-code-use']").evaluate((
      el: HTMLElement,
    ) => el.click());
    await page.waitForURL((u: URL) => u.pathname === "/welcome", {
      timeout: 30_000,
    });
    await expect.see("Lo primero — ¿cómo te llamamos?");
    expect.eq(
      await page.locator("[data-cy='welcome-lang-es']").getAttribute(
        "aria-pressed",
      ),
      "true",
      "M33: ES picked on /verify is the wizard's language",
    );
  }));
