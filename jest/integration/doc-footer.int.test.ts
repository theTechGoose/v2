/**
 * REQ-509 — demo-loop cycle 3, issue m24 ("fix every issue the demo found, loop
 * until there are none"): the SSR markup of the contractor's public customer
 * documents — the quote /q/:id, the invoice /i/:id, the change order /co/:id —
 * ends with the `document` footer: the four policy links and "Powered by
 * DocuMonster", never DocuMonster's support phone or mailing address (it sat
 * under the contractor's own contact block and confused the customer).
 */
import { contractor, seedInvoice, seedQuote } from "./helpers/api";

const FRONT = (process.env.API_BASE_URL ?? "http://localhost:5280/api").replace(
  /\/api$/,
  "",
);

async function page(path: string, lang = "en") {
  const res = await fetch(`${FRONT}${path}`, {
    headers: { cookie: `pm_lang=${lang}` },
    redirect: "manual",
  });
  return { status: res.status, html: await res.text() };
}

function footer(html: string): string {
  const m = html.match(/<footer\b[^>]*data-site-footer[\s\S]*?<\/footer>/);
  expect(m).not.toBeNull();
  return m![0];
}

function expectDocumentFooter(html: string, lang: "en" | "es" = "en") {
  const f = footer(html);
  expect(f).toContain("data-site-footer-document");
  for (const p of ["/terms", "/refund-policy", "/privacy", "/sms-terms"]) {
    expect(f).toContain(`href="${p}"`);
  }
  expect(f).toContain(
    lang === "en"
      ? "Powered by DocuMonster"
      : "Con la tecnología de DocuMonster",
  );
  expect(f).not.toContain("tel:");
  expect(f).not.toContain("855-362-8666");
  expect(f).not.toContain("4505 Socastee Blvd");
}

describe("REQ-509 m24 the customer documents end with the document footer", () => {
  it("REQ-509 /q/:id → policy links + Powered by DocuMonster, no DocuMonster phone or address", async () => {
    const s = await contractor("+15125550509");
    const id = await seedQuote(s);
    const r = await page(`/q/${id}`);
    expect(r.status).toBe(200);
    expectDocumentFooter(r.html);
    const es = await page(`/q/${id}?lang=es`, "es");
    expectDocumentFooter(es.html, "es");
  });

  it("REQ-509 /i/:id → policy links + Powered by DocuMonster, no DocuMonster phone or address", async () => {
    const s = await contractor("+15125550509");
    const id = await seedInvoice(s);
    const r = await page(`/i/${id}`);
    expect(r.status).toBe(200);
    expectDocumentFooter(r.html);
  });

  it("REQ-509 /co/:id → policy links + Powered by DocuMonster, no DocuMonster phone or address", async () => {
    const s = await contractor("+15125550509");
    const inv = await seedInvoice(s);
    const co = await s.post(`/invoices/${inv}/change-orders`, {
      description: "Haul extra debris",
      deltaAmountCents: 15000,
    });
    expect(co.status).toBeLessThan(400);
    const r = await page(`/co/${co.body.id}`);
    expect(r.status).toBe(200);
    expectDocumentFooter(r.html);
  });
});
