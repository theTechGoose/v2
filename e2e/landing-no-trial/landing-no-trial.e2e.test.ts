/**
 * REQ-505 — Raphael, 2026-11-12: "fix every issue the demo found, loop until
 * there are none." Demo-loop cycle 3 (run re05e1cbb), issue m5 — "Landing
 * promises a 30-day free trial; plan step charges $99 today".
 *
 * Billing has no trial (the plan step reads "$99 today · prorated on the 1st ·
 * then $99/month"), so neither landing page — in either language, before or
 * after the EN/ES toggle — may promise one. The pricing note says what billing
 * does: cancel anytime.
 */
import { story, type StoryTools } from "#shots";

const DESKTOP = { width: 1280, height: 900 };
const TRIAL_RE =
  /free trial|free for \d+ days|\d+ days free|prueba gratis|gratis por \d+|\d+ d[ií]as gratis|\{d\}/i;

/** Everything a visitor can read: body text, the title, the meta description. */
async function visibleCopy(page: StoryTools["page"]): Promise<string> {
  return await page.evaluate(() =>
    [
      document.title,
      document.querySelector('meta[name="description"]')?.getAttribute(
        "content",
      ) ?? "",
      document.body.innerText,
    ].join("\n")
  );
}

Deno.test("REQ-505 m5: / and /landing (en + es, and after the EN/ES toggle) promise no free trial; / says cancel anytime", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);

    for (const lang of ["en", "es"]) {
      await page.goto(`/landing?lang=${lang}`);
      await page.locator("#trial-phone").waitFor({ state: "visible" });
      const copy = await visibleCopy(page);
      expect.eq(
        copy.match(TRIAL_RE)?.[0] ?? null,
        null,
        `/landing?lang=${lang} makes no trial claim`,
      );
    }

    await page.goto("/?lang=es");
    const note = page.locator('[data-i18n="price.plans.terms"]');
    await note.waitFor({ state: "attached" });
    expect.eq(
      (await visibleCopy(page)).match(TRIAL_RE)?.[0] ?? null,
      null,
      "/?lang=es makes no trial claim",
    );
    expect(
      /cancela cuando quieras/i.test((await note.textContent()) ?? ""),
      "the Spanish pricing note says cancela cuando quieras",
    );

    // The client toggle re-fills every data-i18n node from the dictionary.
    await page.locator('.lang-toggle button[data-lang="en"]').click();
    await page.waitForFunction(
      () =>
        /cancel anytime/i.test(
          document.querySelector('[data-i18n="price.plans.terms"]')
            ?.textContent ?? "",
        ),
      undefined,
      { timeout: 10_000 },
    ).catch(() => {});
    expect(
      /cancel anytime/i.test((await note.textContent()) ?? ""),
      "after EN the pricing note says Cancel anytime",
    );
    expect.eq(
      (await visibleCopy(page)).match(TRIAL_RE)?.[0] ?? null,
      null,
      "/ after the EN toggle makes no trial claim",
    );
  }));
