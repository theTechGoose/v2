/**
 * REQ-218 — over the REAL dev stack (frontend :5280): what a crawler is
 * served. Google Search Console, 2026-11-09, on documonster.com: "Duplicate
 * without user-selected canonical" and "Not found (404)".
 *
 * Probed on prod 2026-11-10 (the state these tests were red against):
 *   GET /contact, /privacy, /terms, /sms-terms, /refund-policy — each 200 at
 *       the bare URL, ?lang=en and ?lang=es, with no <link rel="canonical">
 *   GET /icon-192.png, /icon-512.png, /icon-maskable-512.png → 404, all three
 *       named by /manifest.webmanifest
 */
const FE = process.env.FRONTEND_BASE_URL ?? "http://localhost:5280";
const ORIGIN = "https://documonster.com";

const PAGES = [
  "/contact",
  "/privacy",
  "/terms",
  "/sms-terms",
  "/refund-policy",
];
const VARIANTS = ["", "?lang=en", "?lang=es"];

describe("REQ-218 the public pages name one canonical URL, whatever language was asked for", () => {
  for (const p of PAGES) {
    for (const q of VARIANTS) {
      it(`REQ-218 GET ${p}${q} carries exactly one canonical: ${ORIGIN}${p}`, async () => {
        const res = await fetch(`${FE}${p}${q}`, { redirect: "manual" });
        expect(res.status).toBe(200);
        const body = await res.text();
        const tags = body.match(/<link[^>]*rel="canonical"[^>]*>/g) ?? [];
        expect(tags).toHaveLength(1);
        expect(tags[0].match(/href="([^"]+)"/)?.[1]).toBe(`${ORIGIN}${p}`);
      });
    }
  }
});

describe("REQ-218 every icon the web manifest names is served", () => {
  it("REQ-218 each manifest icon answers 200 image/png", async () => {
    const manifest = await (await fetch(`${FE}/manifest.webmanifest`))
      .json() as {
        icons: { src: string }[];
      };
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      const res = await fetch(`${FE}${icon.src}`, { redirect: "manual" });
      await res.arrayBuffer();
      expect({ src: icon.src, status: res.status }).toEqual({
        src: icon.src,
        status: 200,
      });
      expect(res.headers.get("content-type")).toMatch(/^image\/png/);
    }
  });
});
