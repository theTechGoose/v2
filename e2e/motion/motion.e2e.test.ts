/**
 * REQ-195 — the motion system is live on every page: the tokens resolve, the view-transition
 * opt-in and the press-feedback rule are in the loaded stylesheet, the direction script ran,
 * entrances rise in, and under reduced motion they fade instead.
 */
import { story } from "#shots";

Deno.test("REQ-195: motion.css and the pagereveal tagger are on the page; entrances rise, reduced motion fades", (t) =>
  story(t, async ({ page, expect }) => {
    await page.goto("/worker?lang=en");
    await page.locator("[data-cy='w-cell']").waitFor({ timeout: 15_000 });
    const facts = await page.evaluate(() => {
      const rules: string[] = [];
      for (const ss of Array.from(document.styleSheets)) {
        try {
          for (const r of Array.from(ss.cssRules)) rules.push(r.cssText);
        } catch { /* cross-origin sheet */ }
      }
      const first = document.querySelector("[data-stagger] > *") as HTMLElement;
      return {
        dur: getComputedStyle(document.documentElement).getPropertyValue(
          "--pm-dur-base",
        ).trim(),
        tagger: (globalThis as unknown as { __pmMotion?: number }).__pmMotion,
        viewTransition: rules.some((r) => r.includes("@view-transition")),
        press: rules.some((r) =>
          r.includes(":active") && r.includes("scale(0.97)")
        ),
        rail: rules.some((r) => r.includes("view-transition-name: pm-rail")),
        entrance: getComputedStyle(first).animationName,
      };
    });
    expect.eq(facts.dur, "200ms", "the duration token resolves on <html>");
    expect.eq(facts.tagger, 1, "the pagereveal tagger ran from <head>");
    expect(
      facts.viewTransition,
      "the page opted into cross-document view transitions",
    );
    expect(facts.press, "buttons scale to .97 on press");
    expect(facts.rail, "the dashboard rail is a named transition element");
    expect.eq(facts.entrance, "pm-rise", "the first child rises in");
    // reduced motion: the movement goes, a fade stays
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/worker?lang=en");
    await page.locator("[data-cy='w-cell']").waitFor({ timeout: 15_000 });
    const reduced = await page.evaluate(() =>
      getComputedStyle(
        document.querySelector("[data-stagger] > *") as HTMLElement,
      ).animationName
    );
    expect.eq(
      reduced,
      "vt-fade-in",
      "under reduced motion the entrance is a plain fade",
    );
  }));
