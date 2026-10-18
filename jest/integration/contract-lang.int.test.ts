/**
 * REQ-048 (2026-09-30), Raphael: "the contract should be english first and
 * then there should be a toggle to turn the contract to spanish in real time.
 * should be easy to view in whatever language you want."
 *
 * Over HTTP: a contractor whose outgoing-comms language is Spanish sends a
 * quote; the public /q/:id page server-renders its EN | ES toggle with
 * English pressed unless the link (?lang=) or the visitor's pm_lang cookie
 * already picked Spanish.
 */
import { contractor, seedQuote } from "./helpers/api";

const FRONT = process.env.FRONTEND_BASE_URL ?? "http://localhost:5280";

async function page(path: string, cookie?: string) {
  const res = await fetch(`${FRONT}${path}`, {
    headers: cookie ? { cookie } : {},
  });
  return { status: res.status, html: await res.text() };
}

function pressed(html: string, lang: "en" | "es"): boolean | null {
  const m = html.match(
    new RegExp(`<button[^>]*data-contract-lang="${lang}"[^>]*aria-pressed="(true|false)"`),
  ) ?? html.match(
    new RegExp(`<button[^>]*aria-pressed="(true|false)"[^>]*data-contract-lang="${lang}"`),
  );
  return m ? m[1] === "true" : null;
}

describe("REQ-048 /q/:id — English first, toggle server-rendered", () => {
  let quoteId = "";

  beforeAll(async () => {
    const s = await contractor("+15125550948");
    const ident = await s.put("/profile/identity", {
      businessName: "Contrato ES LLC",
      commsLanguage: "es",
    });
    expect(ident.status).toBeLessThan(400);
    quoteId = await seedQuote(s);
  });

  it("REQ-048 with no choice, an ES-comms contractor's contract renders with EN pressed", async () => {
    const r = await page(`/q/${quoteId}`);
    expect(r.status).toBe(200);
    expect(pressed(r.html, "en")).toBe(true);
    expect(pressed(r.html, "es")).toBe(false);
  });

  it("REQ-048 ?lang=es on the link opens Spanish", async () => {
    const r = await page(`/q/${quoteId}?lang=es`);
    expect(r.status).toBe(200);
    expect(pressed(r.html, "es")).toBe(true);
    expect(pressed(r.html, "en")).toBe(false);
  });

  it("REQ-048 the visitor's pm_lang=es pick opens Spanish; ?lang=en on the link beats it", async () => {
    const es = await page(`/q/${quoteId}`, "pm_lang=es");
    expect(pressed(es.html, "es")).toBe(true);
    const en = await page(`/q/${quoteId}?lang=en`, "pm_lang=es");
    expect(pressed(en.html, "en")).toBe(true);
    expect(pressed(en.html, "es")).toBe(false);
  });
});
