/**
 * REQ-044 — "change the number everywhere on the site to 855-362-8666. add
 * the phone number to the footer on every page as well as the address."
 *
 * Fetches every SSR page family from the dev front-end (:5280) — anonymous
 * pages, the two landings, the logged-in app shell, the public customer
 * documents, the branded 404 — and asserts each carries the footer's
 * tel: link to 855-362-8666 and the mailing address, and that no page still
 * serves the old toll-free number anywhere in its markup.
 */
import { contractor, seedInvoice, seedQuote } from "./helpers/api";

const FRONT = (process.env.API_BASE_URL ?? "http://localhost:5280/api").replace(/\/api$/, "");

async function page(path: string, cookie?: string) {
  const res = await fetch(`${FRONT}${path}`, {
    headers: { cookie: ["pm_lang=en", cookie].filter(Boolean).join("; ") },
    redirect: "manual",
  });
  return { status: res.status, html: await res.text() };
}

const PHONE_DISPLAY = "855-362-8666";
const PHONE_HREF = 'href="tel:+18553628666"';
const ADDRESS = "4505 Socastee Blvd, Myrtle Beach, SC 29588";
const OLD_NUMBER = /866[^0-9a-z]{0,3}767[^0-9a-z]{0,3}8399/i;

/** Every `<a … data-site-phone …>…</a>` in the page. */
function phoneLinks(html: string): { tag: string; text: string }[] {
  return [...html.matchAll(/<a\b([^>]*\bdata-site-phone\b[^>]*)>([\s\S]*?)<\/a>/g)]
    .map((m) => ({ tag: m[1], text: m[2].replace(/<[^>]+>/g, "").trim() }));
}

function expectFooterContact(html: string) {
  const links = phoneLinks(html);
  expect(links.length).toBeGreaterThanOrEqual(1);
  for (const l of links) {
    expect(l.tag).toContain(PHONE_HREF);
    expect(l.text).toContain(PHONE_DISPLAY);
  }
  expect(html).toMatch(new RegExp(`data-site-address[^>]*>[^<]*${ADDRESS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
}

function expectNoOldNumber(html: string) {
  expect(html).not.toMatch(OLD_NUMBER);
}

const ANON = ["/?lang=en", "/landing?lang=en", "/login", "/contact", "/terms", "/verify?phone=%2B15125550930"];

describe("REQ-044 every SSR page family carries the footer phone link", () => {
  for (const path of ANON) {
    it(`REQ-044 anonymous ${path} → footer phone + address`, async () => {
      const r = await page(path);
      expect(r.status).toBe(200);
      expectFooterContact(r.html);
    });
  }

  it("REQ-044 the branded 404 → footer phone + address", async () => {
    const r = await page("/this-page-does-not-exist-req-044");
    expect(r.status).toBe(404);
    expectFooterContact(r.html);
  });

  describe("logged-in app shell", () => {
    const APP = ["/dashboard", "/quotes", "/invoices", "/payments", "/clients", "/customers", "/settings", "/assistant"];
    let cookie = "";
    beforeAll(async () => {
      const s = await contractor("+15125550940");
      await s.post("/me/onboarded", { skipped: true });
      cookie = s.cookieHeaderValue();
    });
    for (const path of APP) {
      it(`REQ-044 ${path} → footer phone + address`, async () => {
        const r = await page(path, cookie);
        expect(r.status).toBe(200);
        expectFooterContact(r.html);
        expectNoOldNumber(r.html);
      });
    }
    it("REQ-044 /welcome (a not-yet-onboarded contractor) → footer phone + address", async () => {
      // /welcome 302s an onboarded contractor to /dashboard; a fresh sign-in
      // is the one visitor who actually sees it.
      const fresh = await contractor("+15125550944");
      const r = await page("/welcome", fresh.cookieHeaderValue());
      expect(r.status).toBe(200);
      expectFooterContact(r.html);
      expectNoOldNumber(r.html);
    });
  });

  describe("public customer documents", () => {
    it("REQ-044 /q/:id (agreement) → footer phone + address", async () => {
      const s = await contractor("+15125550941");
      const id = await seedQuote(s);
      const r = await page(`/q/${id}`);
      expect(r.status).toBe(200);
      expectFooterContact(r.html);
      expectNoOldNumber(r.html);
    });
    it("REQ-044 /i/:id (invoice) → footer phone + address", async () => {
      const s = await contractor("+15125550941");
      const id = await seedInvoice(s);
      const r = await page(`/i/${id}`);
      expect(r.status).toBe(200);
      expectFooterContact(r.html);
      expectNoOldNumber(r.html);
    });
  });
});

describe("REQ-044 every SSR page family carries the footer address", () => {
  it("REQ-044 every SSR page family carries the footer address", async () => {
    for (const path of ANON) {
      const r = await page(path);
      expect(r.html).toContain(ADDRESS);
    }
  });
});

describe("REQ-044 no page still serves the old number", () => {
  for (const path of ANON) {
    it(`REQ-044 ${path} has no 866-767-8399 anywhere, and every tel: link dials the new number`, async () => {
      const r = await page(path);
      expectNoOldNumber(r.html);
      const tels = [...r.html.matchAll(/href="tel:([^"]+)"/g)].map((m) => m[1]);
      expect(tels.length).toBeGreaterThanOrEqual(1);
      for (const t of tels) expect(t).toBe("+18553628666");
    });
  }
  it("REQ-044 the Spanish landings dial the new number too", async () => {
    for (const path of ["/?lang=es", "/landing?lang=es"]) {
      const res = await fetch(`${FRONT}${path}`, { redirect: "manual" });
      const html = await res.text();
      expectNoOldNumber(html);
      expect(html).toContain(PHONE_DISPLAY);
      expect(html).toContain(ADDRESS);
    }
  });
});
