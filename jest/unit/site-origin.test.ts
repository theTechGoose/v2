/**
 * REQ-085 — Raphael, 2026-10-18, on the /landing2 signup card in prod failing
 * for his own number: "in prod, this makes no sesne" — then "fix it."
 *
 * The site's own origin is documonster.com: the canonical/og:url helper, the
 * sitemap and robots.txt all name it, and none of them names the old domain,
 * which is a forwarder now (404 for every path but "/").
 */
import * as fs from "fs";
import * as path from "path";
import { absoluteUrl, SITE_ORIGIN } from "../../shared/quote-flow/site-meta";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const OLD_DOMAIN = new RegExp("paperworkmonster.com".replace(".", "\\."), "i");

describe("REQ-085: the site's own origin is documonster.com", () => {
  test("REQ-085: SITE_ORIGIN is https://documonster.com and absoluteUrl builds from it", () => {
    expect(SITE_ORIGIN).toBe("https://documonster.com");
    expect(absoluteUrl("/landing2")).toBe("https://documonster.com/landing2");
    expect(absoluteUrl("contact")).toBe("https://documonster.com/contact");
  });

  test("REQ-085: every <loc> of the sitemap is on SITE_ORIGIN, the old domain nowhere in it", () => {
    const xml = read("front-end/static/sitemap.xml");
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      expect(loc.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
    }
    expect(xml).not.toMatch(OLD_DOMAIN);
  });

  test("REQ-085: robots.txt sends crawlers to the sitemap on SITE_ORIGIN", () => {
    const robots = read("front-end/static/robots.txt");
    expect(robots).toMatch(
      new RegExp(
        `^Sitemap: ${SITE_ORIGIN.replace(/\./g, "\\.")}/sitemap\\.xml$`,
        "m",
      ),
    );
    expect(robots).not.toMatch(OLD_DOMAIN);
  });
});
