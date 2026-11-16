/**
 * REQ-880 — Raphael: "For some reason, the phone is shaking on the landing
 * page." Under `prefers-reduced-motion: reduce` the hero's floating pieces must
 * come to rest: each animation runs once (iteration count 1) and finishes, so
 * the compositor is not re-sampling a 0.01ms infinite loop every frame. With
 * motion on, the phone still floats.
 */
import { story } from "#shots";

const PIECES = ".hs-phone, .hs-doc, .hs-blob";

Deno.test("REQ-880: under reduced motion the hero phone, document and blobs run once and settle; with motion on the phone floats", (t) =>
  story(t, async ({ page, expect }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?lang=en");
    await page.locator(".hs-phone").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(300);
    const reduced = await page.evaluate((sel: string) => {
      const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
      return els.map((el) => ({
        cls: el.className,
        iter: getComputedStyle(el).animationIterationCount,
        states: el.getAnimations().map((a) => a.playState),
      }));
    }, PIECES);
    expect(reduced.length >= 4, `hero pieces found (${reduced.length})`);
    for (const r of reduced) {
      expect.eq(
        r.iter,
        "1",
        `${r.cls}: reduced motion runs the animation once`,
      );
      expect(
        r.states.every((s) => s === "finished"),
        `${r.cls}: nothing still running (${r.states.join(",") || "none"})`,
      );
    }

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/?lang=en");
    await page.locator(".hs-phone").waitFor({ timeout: 20_000 });
    const full = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector(".hs-phone")!);
      return { name: cs.animationName, iter: cs.animationIterationCount };
    });
    expect.eq(full.name, "phoneFloat", "with motion on the phone floats");
    expect.eq(full.iter, "infinite", "…and keeps floating");
  }));
