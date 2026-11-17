/**
 * REQ-509 — demo-loop cycle 3, issue m24 ("fix every issue the demo found, loop
 * until there are none"): the SSR markup of the contractor's public customer
 * documents — the quote /q/:id, the invoice /i/:id, the change order /co/:id —
 * ends with the `document` footer: the four policy links and "Powered by
 * DocuMonster", never DocuMonster's support phone or mailing address (it sat
 * under the contractor's own contact block and confused the customer).
 *
 * REQ-573 — demo-loop cycle 4, issue p4-p3c: "'Powered by DocuMonster' shown
 * twice". /q and /i already end their body with "Powered by DocuMonster · …",
 * so their footer drops its own credit; /co (no such line) keeps it.
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

/** REQ-573: how many times the page says "Powered by DocuMonster" (either language) */
const powered = (s: string) =>
  (s.match(/Powered by DocuMonster|Con la tecnología de DocuMonster/g) ?? [])
    .length;

/**
 * `credited` (REQ-573, cycle 4 p4-p3c): the document's own body already ends
 * with "Powered by DocuMonster · …", so the footer must not say it again.
 */
function expectDocumentFooter(
  html: string,
  lang: "en" | "es" = "en",
  credited = false,
) {
  const f = footer(html);
  expect(f).toContain("data-site-footer-document");
  for (const p of ["/terms", "/refund-policy", "/privacy", "/sms-terms"]) {
    expect(f).toContain(`href="${p}"`);
  }
  if (credited) expect(powered(f)).toBe(0);
  else {
    expect(f).toContain(
      lang === "en"
        ? "Powered by DocuMonster"
        : "Con la tecnología de DocuMonster",
    );
  }
  expect(f).not.toContain("tel:");
  expect(f).not.toContain("855-362-8666");
  expect(f).not.toContain("4505 Socastee Blvd");
}

describe("REQ-509 m24 the customer documents end with the document footer", () => {
  it("REQ-509 REQ-573 /q/:id → policy links, no DocuMonster phone or address, and no second Powered by (the quote doc credits it)", async () => {
    const s = await contractor("+15125550509");
    const id = await seedQuote(s);
    const r = await page(`/q/${id}`);
    expect(r.status).toBe(200);
    expectDocumentFooter(r.html, "en", true);
    const es = await page(`/q/${id}?lang=es`, "es");
    expectDocumentFooter(es.html, "es", true);
  });

  it("REQ-509 REQ-573 /i/:id → policy links, no DocuMonster phone or address, Powered by DocuMonster exactly once (the invoice's own line)", async () => {
    const s = await contractor("+15125550509");
    const id = await seedInvoice(s);
    const r = await page(`/i/${id}`);
    expect(r.status).toBe(200);
    expectDocumentFooter(r.html, "en", true);
    // rendered markup only: the footer island's serialized props (a <script>)
    // carry both languages' copy, which no one sees
    expect(powered(r.html.replace(/<script\b[\s\S]*?<\/script>/g, "")))
      .toBe(1);
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
