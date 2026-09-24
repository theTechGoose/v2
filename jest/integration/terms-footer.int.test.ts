/**
 * REQ-043 — "to the bottom of every page in the footer, put a link to 'terms
 * of service' and then link it to html that renders something like this".
 *
 * Fetches every SSR page family from the dev front-end (:5280) — anonymous
 * pages, the logged-in app shell, the public customer documents, the branded
 * 404 — and asserts each carries the site footer's Terms of Service link;
 * then GETs /terms and asserts the three documents render.
 */
import { contractor, seedInvoice, seedQuote } from "./helpers/api";

const FRONT = (process.env.API_BASE_URL ?? "http://localhost:5280/api").replace(/\/api$/, "");

async function page(path: string, cookie?: string) {
  const res = await fetch(`${FRONT}${path}`, {
    // The two landings are Spanish-first by product decision and the other
    // public pages follow Accept-Language — ask for English so the label is
    // the English one the regex pins.
    // The public pages are Spanish-first by product decision (the Accept-
    // Language fallback is deliberately ignored), so the visitor's persisted
    // pm_lang choice is the one way to ask for the English label the regex pins.
    headers: { cookie: ["pm_lang=en", cookie].filter(Boolean).join("; ") },
    redirect: "manual",
  });
  return { status: res.status, html: await res.text(), location: res.headers.get("location") };
}

/** The footer link as the SiteFooter component emits it. */
const LINK = /<a[^>]*data-terms-link[^>]*href="\/terms"[^>]*>Terms of Service<\/a>|<a[^>]*href="\/terms"[^>]*data-terms-link[^>]*>Terms of Service<\/a>/;

describe("REQ-043 every SSR page carries the footer Terms of Service link to /terms", () => {
  const ANON = ["/?lang=en", "/landing?lang=en", "/login", "/contact", "/terms", "/verify?phone=%2B15125550930"];
  for (const path of ANON) {
    it(`REQ-043 anonymous ${path} → footer link`, async () => {
      const r = await page(path);
      expect(r.status).toBe(200);
      expect(r.html).toMatch(LINK);
    });
  }

  it("REQ-043 the branded 404 → footer link", async () => {
    const r = await page("/this-page-does-not-exist-req-043");
    expect(r.status).toBe(404);
    expect(r.html).toMatch(LINK);
  });

  describe("logged-in app shell", () => {
    const APP = ["/dashboard", "/quotes", "/invoices", "/payments", "/clients", "/customers", "/settings", "/assistant"];
    let cookie = "";
    beforeAll(async () => {
      const s = await contractor("+15125550930");
      await s.post("/me/onboarded", { skipped: true });
      cookie = s.cookieHeaderValue();
    });
    for (const path of APP) {
      it(`REQ-043 ${path} → footer link`, async () => {
        const r = await page(path, cookie);
        expect(r.status).toBe(200);
        expect(r.html).toMatch(LINK);
      });
    }
  });

  describe("public customer documents", () => {
    it("REQ-043 /q/:id (agreement) → footer link", async () => {
      const s = await contractor("+15125550931");
      const id = await seedQuote(s);
      const r = await page(`/q/${id}`);
      expect(r.status).toBe(200);
      expect(r.html).toMatch(LINK);
    });
    it("REQ-043 /i/:id (invoice) → footer link", async () => {
      const s = await contractor("+15125550931");
      const id = await seedInvoice(s);
      const r = await page(`/i/${id}`);
      expect(r.status).toBe(200);
      expect(r.html).toMatch(LINK);
    });
  });
});

describe("REQ-043 GET /terms renders the three documents", () => {
  it("REQ-043 titles, effective date, arbitration notice, first and last sections", async () => {
    const r = await page("/terms");
    expect(r.status).toBe(200);
    const html = r.html;
    for (const title of ["Terms of Service", "Refund &amp; Cancellation Policy", "Privacy Policy"]) {
      expect(html).toContain(title);
    }
    expect(html).toContain('id="terms"');
    expect(html).toContain('id="refunds"');
    expect(html).toContain('id="privacy"');
    expect((html.match(/Effective Date: September 24, 2026/g) ?? []).length).toBe(3);
    expect(html).toContain("THIS AGREEMENT IS SUBJECT TO ARBITRATION PURSUANT TO THE SOUTH CAROLINA UNIFORM ARBITRATION ACT.");
    expect(html).toContain("1. Business-to-Business Service");
    expect(html).toContain("31. Contact Us");
    expect(html).toContain("13. How to Request Help With a Billing Issue");
    expect(html).toContain("18. Contact Us");
    expect(html).toMatch(/<li[^>]*>violate applicable law or regulation;<\/li>/);
    expect(html).toContain("Account and Business Information");
  });
});

describe("REQ-043 GET /terms renders in Spanish for a Spanish visitor", () => {
  async function raw(path: string, cookie?: string) {
    const res = await fetch(`${FRONT}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
    return { status: res.status, html: await res.text(), setCookie: res.headers.get("set-cookie") ?? "" };
  }
  it("REQ-043 pm_lang=es → the three documents in Spanish, English absent", async () => {
    const r = await raw("/terms", "pm_lang=es");
    expect(r.status).toBe(200);
    expect(r.html).toContain("Términos de servicio");
    expect(r.html).toContain("Política de reembolsos y cancelaciones");
    expect(r.html).toContain("Política de privacidad");
    expect((r.html.match(/Fecha de vigencia: 24 de septiembre de 2026/g) ?? []).length).toBe(3);
    expect(r.html).toContain("ESTE ACUERDO ESTÁ SUJETO A ARBITRAJE CONFORME A LA LEY UNIFORME DE ARBITRAJE DE CAROLINA DEL SUR.");
    expect(r.html).toContain("1. Servicio de empresa a empresa");
    expect(r.html).toContain("31. Contáctenos");
    expect(r.html).toContain("13. Cómo solicitar ayuda con un problema de facturación");
    expect(r.html).toContain("18. Contáctenos");
    expect(r.html).not.toContain("1. Business-to-Business Service");
    expect(r.html).toContain('data-legal-doc="es"');
  });
  it("REQ-043 ?lang=en over a Spanish cookie → English, and the pick is persisted", async () => {
    const r = await raw("/terms?lang=en", "pm_lang=es");
    expect(r.status).toBe(200);
    expect(r.html).toContain("1. Business-to-Business Service");
    expect(r.html).not.toContain("1. Servicio de empresa a empresa");
    expect(r.setCookie).toMatch(/pm_lang=en/);
  });
  it("REQ-043 ?lang=es → Spanish, and the pick is persisted", async () => {
    const r = await raw("/terms?lang=es", "pm_lang=en");
    expect(r.html).toContain("1. Servicio de empresa a empresa");
    expect(r.setCookie).toMatch(/pm_lang=es/);
  });
  it("REQ-043 the page carries the EN/ES toggle", async () => {
    const r = await raw("/terms");
    expect(r.html).toMatch(/<a[^>]*href="\/terms\?lang=en"[^>]*data-legal-lang="en"/);
    expect(r.html).toMatch(/<a[^>]*href="\/terms\?lang=es"[^>]*data-legal-lang="es"/);
  });
});
