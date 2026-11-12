/**
 * REQ-425 — demo-loop cycle 2, issue p6 ("fix every issue the demo found, loop
 * until there are none"): the SSR markup of the signed-in app shell ends with
 * the compact one-line SiteFooter — still the four policy links, REQ-044's
 * phone and address — while the public pages keep the full footer.
 */
import { contractor } from "./helpers/api";

const FRONT = (process.env.API_BASE_URL ?? "http://localhost:5280/api").replace(
  /\/api$/,
  "",
);

async function page(path: string, cookie?: string) {
  const res = await fetch(`${FRONT}${path}`, {
    headers: { cookie: ["pm_lang=en", cookie].filter(Boolean).join("; ") },
    redirect: "manual",
  });
  return { status: res.status, html: await res.text() };
}

function footerTag(html: string): string {
  const m = html.match(/<footer\b[^>]*data-site-footer[^>]*>/);
  expect(m).not.toBeNull();
  return m![0];
}

describe("REQ-425 p6 the app shell's footer is the compact line", () => {
  let cookie = "";
  beforeAll(async () => {
    const s = await contractor("+15125550425");
    await s.post("/me/onboarded", { skipped: true });
    cookie = s.cookieHeaderValue();
  });

  for (const path of ["/assistant", "/quotes", "/invoices", "/settings"]) {
    it(`REQ-425 ${path} ends with the compact footer — links, phone, address`, async () => {
      const r = await page(path, cookie);
      expect(r.status).toBe(200);
      expect(footerTag(r.html)).toContain("data-site-footer-compact");
      expect((r.html.match(/data-legal-link="/g) ?? []).length)
        .toBeGreaterThanOrEqual(4);
      expect(r.html).toContain('href="tel:+18553628666"');
      expect(r.html).toContain("4505 Socastee Blvd, Myrtle Beach, SC 29588");
    });
  }

  for (const path of ["/login", "/contact"]) {
    it(`REQ-425 ${path} keeps the full footer`, async () => {
      const r = await page(path);
      expect(r.status).toBe(200);
      expect(footerTag(r.html)).not.toContain("data-site-footer-compact");
    });
  }
});
