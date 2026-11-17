/**
 * REQ-272 (2026-11-11), Raphael: "fix every issue the demo found" — demo
 * issue i18n-formatting-m7: "Public invoice /i/ has no EN/ES switch; the
 * quote page has one".
 *
 * Over HTTP: a contractor whose outgoing-comms language is Spanish sends an
 * invoice. The public /i/:id page server-renders an EN | ES toggle; the
 * link's ?lang= wins over the visitor's pm_lang cookie and the document's
 * language, and the document's copy follows it.
 */
import { contractor, seedInvoice } from "./helpers/api";

const FRONT = process.env.FRONTEND_BASE_URL ?? "http://localhost:5280";

async function page(path: string, cookie?: string) {
  const res = await fetch(`${FRONT}${path}`, {
    headers: cookie ? { cookie } : {},
  });
  return { status: res.status, html: await res.text() };
}

/** The toggle link for `lang` — its aria-current and href, or null. */
function toggle(html: string, lang: "en" | "es") {
  const tag = html.match(
    new RegExp(`<a[^>]*data-public-lang="${lang}"[^>]*>`),
  )?.[0];
  if (!tag) return null;
  return {
    current: /aria-current="true"/.test(tag),
    href: tag.match(/href="([^"]*)"/)?.[1]?.replace(/&amp;/g, "&") ?? "",
  };
}

describe("REQ-272 /i/:id — EN | ES toggle, ?lang= honored", () => {
  let invoiceId = "";

  beforeAll(async () => {
    const s = await contractor("+15125550972");
    const ident = await s.put("/profile/identity", {
      businessName: "Factura ES LLC",
      commsLanguage: "es",
    });
    expect(ident.status).toBeLessThan(400);
    invoiceId = await seedInvoice(s);
  });

  it("REQ-272 with no choice the invoice opens in the document's language (es) and offers EN", async () => {
    const r = await page(`/i/${invoiceId}`);
    expect(r.status).toBe(200);
    expect(toggle(r.html, "es")?.current).toBe(true);
    expect(toggle(r.html, "en")?.current).toBe(false);
    expect(toggle(r.html, "en")?.href).toBe(`/i/${invoiceId}?lang=en`);
    expect(r.html).toContain("Descargar PDF");
  });

  it("REQ-272 ?lang=en renders the invoice in English", async () => {
    const r = await page(`/i/${invoiceId}?lang=en`);
    expect(r.status).toBe(200);
    expect(toggle(r.html, "en")?.current).toBe(true);
    expect(toggle(r.html, "es")?.current).toBe(false);
    expect(r.html).toContain("Download PDF");
    expect(r.html).not.toContain("Descargar PDF");
    expect(r.html).toMatch(/<html[^>]*lang="en"/);
  });

  it("REQ-272 ?lang=en on the link beats a pm_lang=es cookie; the cookie alone still wins over the doc", async () => {
    const linked = await page(`/i/${invoiceId}?lang=en`, "pm_lang=es");
    expect(toggle(linked.html, "en")?.current).toBe(true);
    const saved = await page(`/i/${invoiceId}`, "pm_lang=en");
    expect(toggle(saved.html, "en")?.current).toBe(true);
    expect(saved.html).toContain("Download PDF");
  });
});
