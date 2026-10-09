/**
 * REQ-043 — "to the bottom of every page in the footer, put a link to 'terms
 * of service' and then link it to html that renders something like this".
 * REQ-065/066 — the October 6, 2026 text, each document its own page.
 *
 * Fetches every SSR page family from the dev front-end (:5280) — anonymous
 * pages, the logged-in app shell, the public customer documents, the branded
 * 404 — and asserts each carries the site footer's Terms of Service link;
 * then GETs the four legal pages and asserts each document renders.
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

/** The footer's one policies link as the SiteFooter (and the two websites) emit it (REQ-067 amendment). */
const LINK = /<a[^>]*href="\/terms"[^>]*data-legal-footer-link[^>]*>Terms &amp; Policies<\/a>|<a[^>]*data-legal-footer-link[^>]*href="\/terms"[^>]*>Terms &amp; Policies<\/a>/;

describe("REQ-043 every SSR page carries the footer Terms of Service link to /terms", () => {
  const ANON = ["/?lang=en", "/landing?lang=en", "/login", "/contact", "/terms", "/refund-policy", "/privacy", "/sms-terms", "/verify?phone=%2B15125550930"];
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

/** REQ-066 — each document its own page (Hans: "each one on its own separate page"). */
const PAGES = [
  ["/terms", "Terms of Service", "1. Business-to-Business Service", "31. Contact Us"],
  ["/refund-policy", "Refund &amp; Cancellation Policy", "1. Recurring Subscriptions", "13. How to Request Help With a Billing Issue"],
  ["/privacy", "Privacy Policy", "1. Information We Collect", "18. Contact Us"],
  ["/sms-terms", "SMS Terms &amp; Conditions", "1. SMS Program Overview", "10. Contact Us"],
] as const;

describe("REQ-066 each policy page renders its one document under the website's header", () => {
  for (const [path, title, first, last] of PAGES) {
    it(`REQ-066 GET ${path} → ${title}`, async () => {
      const r = await page(path);
      expect(r.status).toBe(200);
      const html = r.html;
      expect(html).toContain(`<h1>${title}</h1>`);
      expect((html.match(/<h1>/g) ?? []).length).toBe(1);
      // REQ-065: the October 6, 2026 text
      expect((html.match(/Last Updated: October 6, 2026/g) ?? []).length).toBe(1);
      expect(html).not.toContain("Effective Date");
      expect(html).toContain(first);
      expect(html).toContain(last);
      // the website's header, then the four documents as tabs with this one current
      expect(html).toMatch(/<div class="nav-wrap">/);
      expect(html).toMatch(/<a href="\/login" class="btn btn-outline">/);
      expect(html).toMatch(new RegExp(`<a href="${path}" data-legal-link="[a-z]+" class="on" aria-current="page">`));
      for (const [other] of PAGES) expect(html).toMatch(new RegExp(`data-legal-nav[^]*?<a href="${other}"`));
    });
  }
  it("REQ-065 /terms: the arbitration notice, the brand line, the acceptable-use list", async () => {
    const html = (await page("/terms")).html;
    expect(html).toContain("THIS AGREEMENT IS SUBJECT TO ARBITRATION PURSUANT TO THE SOUTH CAROLINA UNIFORM ARBITRATION ACT.");
    expect(html).toContain("doing business as DocuMonster Powered by Paperwork Monster");
    expect(html).toMatch(/<li[^>]*>violate applicable law or regulation;<\/li>/);
  });
  it("REQ-065 /privacy: the labeled blocks", async () => {
    expect((await page("/privacy")).html).toContain("Account and Business Information");
  });
});

describe("REQ-043 the legal pages render in Spanish for a Spanish visitor", () => {
  async function raw(path: string, cookie?: string) {
    const res = await fetch(`${FRONT}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
    return { status: res.status, html: await res.text(), setCookie: res.headers.get("set-cookie") ?? "" };
  }
  it("REQ-043 pm_lang=es → the document in Spanish, English absent", async () => {
    const r = await raw("/terms", "pm_lang=es");
    expect(r.status).toBe(200);
    expect(r.html).toContain("<h1>Términos de servicio</h1>");
    expect((r.html.match(/Última actualización: 6 de octubre de 2026/g) ?? []).length).toBe(1);
    expect(r.html).toContain("ESTE ACUERDO ESTÁ SUJETO A ARBITRAJE CONFORME A LA LEY UNIFORME DE ARBITRAJE DE CAROLINA DEL SUR.");
    expect(r.html).toContain("1. Servicio de empresa a empresa");
    expect(r.html).toContain("31. Contáctenos");
    expect(r.html).not.toContain("1. Business-to-Business Service");
    expect(r.html).toContain('data-legal-doc="es"');
    const sms = await raw("/sms-terms", "pm_lang=es");
    expect(sms.html).toContain("<h1>Términos y condiciones de SMS</h1>");
    expect(sms.html).toContain("1. Descripción del programa de SMS");
  });
  it("REQ-043 ?lang=en over a Spanish cookie → English, and the pick is persisted", async () => {
    const r = await raw("/terms?lang=en", "pm_lang=es");
    expect(r.status).toBe(200);
    expect(r.html).toContain("1. Business-to-Business Service");
    expect(r.html).not.toContain("1. Servicio de empresa a empresa");
    expect(r.setCookie).toMatch(/pm_lang=en/);
  });
  it("REQ-043 ?lang=es → Spanish, and the pick is persisted", async () => {
    const r = await raw("/refund-policy?lang=es", "pm_lang=en");
    expect(r.html).toContain("1. Suscripciones recurrentes");
    expect(r.setCookie).toMatch(/pm_lang=es/);
  });
  it("REQ-043 the page carries the EN/ES toggle, in the website's header", async () => {
    const r = await raw("/privacy");
    expect(r.html).toMatch(/<a href="\/privacy\?lang=en" data-legal-lang="en"/);
    expect(r.html).toMatch(/<a href="\/privacy\?lang=es" data-legal-lang="es"/);
  });
});
