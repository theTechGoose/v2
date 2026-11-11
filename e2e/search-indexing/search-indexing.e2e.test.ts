/**
 * REQ-218 — Raphael, 2026-11-10, forwarding Google Search Console's "New
 * reasons prevent pages from being indexed on site documonster.com": "i got
 * This email about this site."
 *
 * In a real browser: /contact and the four legal pages each name ONE canonical
 * URL — the bare path on documonster.com — in either language, and every icon
 * the web manifest names loads.
 *
 * Pages: front-end/routes/contact.tsx; terms.tsx, refund-policy.tsx,
 * privacy.tsx, sms-terms.tsx through front-end/components/LegalPage.tsx;
 * front-end/static/manifest.webmanifest and its icon-*.png.
 */
import { story } from "#shots";

const ORIGIN = "https://documonster.com";
const DESKTOP = { width: 1280, height: 900 };
const PAGES = [
  "/contact",
  "/privacy",
  "/terms",
  "/sms-terms",
  "/refund-policy",
];

Deno.test("REQ-218: the contact and legal pages name one canonical URL in either language", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    for (const path of PAGES) {
      for (const query of ["", "?lang=en", "?lang=es"]) {
        await page.goto(`${path}${query}`);
        const hrefs: string[] = await page.locator('link[rel="canonical"]')
          .evaluateAll((els: Element[]) =>
            els.map((el) => el.getAttribute("href") ?? "")
          );
        expect(
          hrefs.length === 1 && hrefs[0] === `${ORIGIN}${path}`,
          `${path}${query}: one canonical, ${ORIGIN}${path} (got ${
            JSON.stringify(hrefs)
          })`,
        );
      }
    }
  }));

Deno.test("REQ-218: every icon the web manifest names loads", (t) =>
  story(t, async ({ page, expect, http }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    const href = await page.locator('link[rel="manifest"]').getAttribute(
      "href",
    );
    expect(!!href, `the page links a manifest (${href})`);
    const manifest = await (await http(href!)).json() as {
      icons: { src: string; sizes: string }[];
    };
    expect(manifest.icons.length > 0, "the manifest lists icons");
    for (const icon of manifest.icons) {
      const res = await http(icon.src);
      await res.body?.cancel();
      expect(res.status === 200, `${icon.src} is served (got ${res.status})`);
      const [w, h] = icon.sizes.split("x").map(Number);
      const size = await page.evaluate(
        (src: string) =>
          new Promise<string>((resolve) => {
            const img = new Image();
            img.onload = () =>
              resolve(`${img.naturalWidth}x${img.naturalHeight}`);
            img.onerror = () => resolve("failed to load");
            img.src = src;
          }),
        icon.src,
      );
      expect(
        size === `${w}x${h}`,
        `${icon.src} is a ${icon.sizes} image (got ${size})`,
      );
    }
  }));
