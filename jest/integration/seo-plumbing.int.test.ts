/**
 * SEO / PWA / public-page plumbing over the REAL dev stack (frontend :5280).
 *
 * P-55 "[ADS] /robots.txt and /sitemap.xml 404 — no way to keep /q /c /i
 *       customer documents out of search engines."
 * P-56 "[ADS] Unstyled plaintext 404. A mistyped ad URL dumps a paid visitor
 *       on the default 'Not Found' — no branding, no way back."
 * P-57 "[ADS] No theme-color, no manifest — default gray mobile-Chrome
 *       address bar on 100%-mobile traffic."
 * P-12 "[PUBLIC] The money pages ignore localization — /i and /co are
 *       English-only." (server/SSR half — the pm_lang=es cookie must drive
 *       the invoice chrome language)
 *
 * Probed current (buggy) state, 2026-08-18:
 *   GET /robots.txt              → 404 text/plain, body "Not Found"
 *   GET /sitemap.xml             → 404 text/plain, body "Not Found"
 *   GET /definitely-not-a-page-xyz → 404 text/plain, body exactly "Not Found"
 *   GET /                        → HTML with NO theme-color meta, NO manifest link
 *   GET /i/:id  (Cookie: pm_lang=es) → SSR body contains "Bill to",
 *       "Amount due", "How would you like to pay?" — 100% EN chrome.
 */
import {
  contractor,
  seedCustomer,
  seedInvoice,
  seedQuote,
} from "./helpers/api";

const FE = "http://localhost:5280";

async function page(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; type: string; body: string }> {
  const res = await fetch(`${FE}${path}`, { headers, redirect: "manual" });
  return {
    status: res.status,
    type: res.headers.get("content-type") ?? "",
    body: await res.text(),
  };
}

describe("P-55 robots.txt + sitemap.xml exist and fence off customer documents", () => {
  it("P-55 GET /robots.txt returns 200 text", async () => {
    const r = await page("/robots.txt");
    expect(r.status).toBe(200);
    expect(r.type).toMatch(/text\/plain/);
  });

  it("P-55 robots.txt disallows the /q /c /i /co customer-document paths", async () => {
    const r = await page("/robots.txt");
    expect(r.body).toMatch(/^User-agent:/im);
    // Each customer-document namespace must carry a Disallow rule
    // ("Disallow: /q" or "Disallow: /q/" both count).
    for (const path of ["q", "c", "i", "co"]) {
      expect(r.body).toMatch(
        new RegExp(`^Disallow:\\s*/${path}(/|\\s|$)`, "im"),
      );
    }
  });

  it("P-55 GET /sitemap.xml returns 200 XML listing marketing pages only", async () => {
    const r = await page("/sitemap.xml");
    expect(r.status).toBe(200);
    expect(r.type).toMatch(/xml/);
    expect(r.body).toContain("<urlset");
    // At least one marketing URL is listed…
    expect(r.body).toMatch(/<loc>https?:\/\/[^<]+<\/loc>/);
    // …and no customer documents ever are.
    expect(r.body).not.toMatch(/<loc>[^<]*\/(q|c|i|co)\//);
  });
});

describe("P-56 custom branded 404 page", () => {
  it("P-56 a bogus path returns HTTP 404 with a branded HTML page, not the bare default", async () => {
    const r = await page("/definitely-not-a-page-xyz");
    expect(r.status).toBe(404);
    // Not today's bare plaintext body…
    expect(r.body.trim()).not.toBe("Not Found");
    expect(r.type).toMatch(/text\/html/);
    // …but a branded page (app name from lang/en.json brand.name) with a
    // way back home.
    expect(r.body).toContain("Paperwork Monster");
    expect(r.body).toMatch(/href="\/"/);
  });
});

describe("P-57 theme-color meta + web app manifest", () => {
  it("P-57 the landing page ships <meta name=theme-color> and a manifest link", async () => {
    const r = await page("/");
    expect(r.status).toBe(200);
    expect(r.body).toMatch(/<meta[^>]*name="theme-color"/);
    expect(r.body).toMatch(/<link[^>]*rel="manifest"/);
  });

  it("P-57 the linked manifest URL itself returns 200 JSON", async () => {
    const r = await page("/");
    const linkTag = r.body.match(/<link[^>]*rel="manifest"[^>]*>/)?.[0];
    expect(linkTag).toBeTruthy();
    const href = linkTag!.match(/href="([^"]+)"/)?.[1];
    expect(href).toBeTruthy();
    const m = await page(href!.startsWith("/") ? href! : `/${href}`);
    expect(m.status).toBe(200);
    const manifest = JSON.parse(m.body);
    expect(typeof manifest.name).toBe("string");
    expect(manifest.name.length).toBeGreaterThan(0);
  });

  it("P-57 a public money document page carries the theme-color meta too", async () => {
    const s = await contractor("+15125552612");
    const invoiceId = await seedInvoice(s, {
      customerId: await seedCustomer(s, { phoneNumber: "+15125552613" }),
      status: "sent",
    });
    const r = await page(`/i/${invoiceId}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatch(/<meta[^>]*name="theme-color"/);
  });
});

describe("P-12 the public invoice SSRs in the customer's pm_lang language", () => {
  let invoiceId: string;

  beforeAll(async () => {
    // English-language contractor (commsLanguage en — loginAs pins
    // language:"en") so any Spanish below can ONLY come from the cookie.
    const s = await contractor("+15125552610");
    const customerId = await seedCustomer(s, { phoneNumber: "+15125552611" });
    const quoteId = await seedQuote(s, { customerId });
    const contract = await s.post("/contracts", {
      quoteId,
      customerId,
      totalAmount: 55000,
    });
    expect(contract.status).toBeLessThan(400);
    // quoteId + contractId → the rich quote-linked document, which is the
    // one that renders the "Bill to" party card.
    invoiceId = await seedInvoice(s, {
      customerId,
      quoteId,
      contractId: contract.body.id,
      status: "sent",
      installmentIndex: 1,
      installmentTotal: 1,
    });
  });

  it("P-12 with Cookie: pm_lang=es the /i SSR body carries no English chrome anchors", async () => {
    const r = await page(`/i/${invoiceId}`, { cookie: "pm_lang=es" });
    expect(r.status).toBe(200);
    // The document itself rendered (not the error card)…
    expect(r.body).toContain("Backyard Junk Removal");
    // …and the EN chrome anchors are gone.
    expect(r.body).not.toContain("Bill to");
    expect(r.body).not.toContain("Amount due");
  });

  it("P-12 with Cookie: pm_lang=es the /i SSR body carries the Spanish anchors from lang/es.json", async () => {
    const r = await page(`/i/${invoiceId}`, { cookie: "pm_lang=es" });
    expect(r.body).toContain("Facturar a"); // publicInvoice.billTo
    expect(r.body).toContain("Monto a pagar"); // publicInvoice.amountDue
  });
});
