/**
 * REQ-218 — Raphael, 2026-11-10, forwarding Google Search Console's "New
 * reasons prevent pages from being indexed on site documonster.com"
 * (Duplicate without user-selected canonical · Not found (404) · Blocked by
 * robots.txt · Page with redirect): "i got This email about this site."
 *
 * Two of the four were ours to fix, both proven on prod that day:
 *  - /contact and the four legal pages shipped NO canonical, and each answers
 *    at three URLs (bare, ?lang=en, ?lang=es) — duplicates with nothing
 *    saying which one is the page.
 *  - /manifest.webmanifest named /icon-192.png, /icon-512.png and
 *    /icon-maskable-512.png; none of the three ever existed (404).
 */
import * as fs from "fs";
import * as path from "path";
import { LEGAL_LINKS } from "../../shared/legal/terms";

const ROOT = path.resolve(__dirname, "../..");
const STATIC = path.join(ROOT, "front-end/static");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file);
  expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("REQ-218: every public page names its one canonical URL", () => {
  test("REQ-218: the legal pages' shared component links a canonical built from the document's own path", () => {
    const src = read("front-end/components/LegalPage.tsx");
    expect(src).toMatch(
      /<link\s+rel="canonical"\s+href=\{absoluteUrl\(path\)\}/,
    );
    // the four documents it serves — the paths the canonical is built from
    expect(LEGAL_LINKS.map((l) => l.path).sort()).toEqual([
      "/privacy",
      "/refund-policy",
      "/sms-terms",
      "/terms",
    ]);
  });

  test("REQ-218: /contact links its canonical", () => {
    const src = read("front-end/routes/contact.tsx");
    expect(src).toMatch(
      /<link\s+rel="canonical"\s+href=\{absoluteUrl\("\/contact"\)\}/,
    );
  });

  test("REQ-218: every page the sitemap lists has a route that links a canonical", () => {
    const xml = read("front-end/static/sitemap.xml");
    const paths = [
      ...xml.matchAll(/<loc>https:\/\/documonster\.com([^<]*)<\/loc>/g),
    ]
      .map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      const route = p === "/" ? "index" : p.slice(1);
      const src = read(`front-end/routes/${route}.tsx`);
      expect({ page: p, canonical: /rel="canonical"/.test(src) }).toEqual({
        page: p,
        canonical: true,
      });
    }
  });
});

describe("REQ-218: the web manifest names only icons that exist", () => {
  const manifest = JSON.parse(
    read("front-end/static/manifest.webmanifest"),
  ) as {
    icons: { src: string; sizes: string; type: string; purpose: string }[];
  };

  test("REQ-218: the manifest still offers a 192, a 512 and a maskable 512", () => {
    expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`).sort()).toEqual(
      [
        "192x192 any",
        "512x512 any",
        "512x512 maskable",
      ],
    );
  });

  test("REQ-218: each icon is a file in static/, a PNG of the size the manifest declares", () => {
    for (const icon of manifest.icons) {
      const file = path.join(STATIC, icon.src);
      expect({ src: icon.src, exists: fs.existsSync(file) }).toEqual({
        src: icon.src,
        exists: true,
      });
      const { width, height } = pngSize(file);
      expect(`${width}x${height}`).toBe(icon.sizes);
      expect(icon.type).toBe("image/png");
    }
  });
});
