/**
 * REQ-825 — demo-loop cycle dm2, issue p9: the 404 page (a mistyped URL such as /w) loads the
 * Inter webfont, like the demo stage, so the customer's demo pill — styled with PILL_FONT, whose
 * first face is Inter — reads in the app's sans there too, never a box's monospace fallback.
 */
import { story } from "#shots";

Deno.test("REQ-825: the 404 page loads Inter, so a pill drawn in PILL_FONT reads in Inter", (t) =>
  story(t, async ({ page, expect }) => {
    await page.goto("/w");
    await page.locator("h1").first().waitFor({ timeout: 15000 });
    // a probe drawn like the pill: the page's own font stack resolves Inter once it is loaded
    const r = await page.evaluate(async () => {
      const probe = document.createElement("span");
      probe.textContent = "Alexandra is guiding you";
      probe.style.cssText = "font-size:13px";
      document.body.appendChild(probe);
      await document.fonts.load('13px "Inter"', probe.textContent);
      await document.fonts.ready;
      const inter = [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Inter" && f.status === "loaded");
      return { inter, family: getComputedStyle(probe).fontFamily };
    });
    expect(r.family.startsWith('"Inter"') || r.family.startsWith("Inter"), `the 404 body's font starts with Inter — ${r.family}`);
    expect(r.inter, "the 404 page has a loaded Inter face (error-page.css @imports it, like demo-stage.css)");
  }));
