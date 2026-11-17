/**
 * REQ-628 — A2Z Landscape feedback relayed by Raphael, 2026-11-12: "They NEED THEIR LOGO NOT
 * OURS". Every page their customer opens — the invoice (/i), the quote + agreement (/q, the
 * quote-doc component), the change order (/co) — shows the business's own logo, or its name as
 * a text wordmark; never the DocuMonster logo, never "Powered by DocuMonster", never
 * "DocuMonster" as a header fallback or in the browser-tab title.
 */
import * as fs from "fs";
import * as path from "path";
import {
  publicBusinessLabel,
  publicDocTitle,
} from "../../shared/documents/public-brand";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dict = (l: string) =>
  JSON.parse(read(`lang/${l}.json`)) as Record<string, string>;

describe("REQ-628 their brand on the customer's pages", () => {
  const pages = {
    invoice: read("front-end/routes/i/[id].tsx"),
    quoteDoc: read("front-end/components/quote-doc.tsx"),
    quoteRoute: read("front-end/routes/q/[id].tsx"),
    quoteView: read("front-end/islands/PublicQuoteView.tsx"),
    changeOrder: read("front-end/routes/co/[id].tsx"),
  };
  const brand = read("front-end/components/BizBrand.tsx");

  test("REQ-628 no customer page shows the DocuMonster logo, the powered-by footer, or the brand name", () => {
    for (const [name, src] of Object.entries(pages)) {
      expect([name, /["'`]\/logo(-monster|-email)?\.png/.test(src)]).toEqual([name, false]);
      expect([name, /poweredBy/i.test(src)]).toEqual([name, false]);
      expect([name, src.includes('"brand.name"')]).toEqual([name, false]);
      expect([name, /DocuMonster/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))]).toEqual([name, false]);
    }
  });

  test("REQ-628 the invoice, quote and change-order headers are the BizBrand: the logo when one is on file, else the business name as a wordmark", () => {
    expect(pages.invoice).toMatch(/<BizBrand[\s\S]*?logoSrc=\{\s*invoice\.contractor\?\.hasLogo/);
    expect(pages.quoteDoc).toMatch(/<BizBrand[\s\S]*?logoSrc=\{\s*contractor\?\.hasLogo/);
    expect(pages.changeOrder).toMatch(/<BizBrand[\s\S]*?logoSrc=\{\s*co\.hasLogo/);
    // the logo scales into a fixed box keeping its aspect ratio
    expect(brand).toMatch(/data-cy="biz-logo"/);
    expect(brand).toMatch(/object-fit:\s*contain/);
    expect(brand).toMatch(/max-width:\s*200px/);
    expect(brand).toMatch(/max-height:\s*64px/);
    // no logo → the name as a wordmark
    expect(brand).toMatch(/data-cy="biz-wordmark"/);
  });

  test("REQ-628 the tab titles name the business, and no customer-page title names DocuMonster in either language", () => {
    expect(pages.invoice).toMatch(/publicDocTitle\(/);
    expect(pages.changeOrder).toMatch(/publicDocTitle\(/);
    expect(pages.quoteView).toMatch(/publicDocTitle\(/);
    for (const l of ["en", "es"]) {
      const d = dict(l);
      for (
        const k of [
          "publicInvoice.docTitle",
          "quoteDoc.docTitle",
          "changeOrderPublic.docTitle",
        ]
      ) {
        expect([l, k, /DocuMonster/.test(d[k])]).toEqual([l, k, false]);
      }
    }
  });

  test("REQ-628 publicBusinessLabel / publicDocTitle — the business, else the contractor, never DocuMonster", () => {
    expect(publicBusinessLabel({ businessName: " A2Z Landscape LLC ", name: "Alexander" })).toBe("A2Z Landscape LLC");
    expect(publicBusinessLabel({ name: "Alexander Jerez" })).toBe("Alexander Jerez");
    expect(publicBusinessLabel(undefined)).toBeUndefined();
    expect(publicDocTitle("Invoice", "A2Z Landscape LLC")).toBe("Invoice · A2Z Landscape LLC");
    expect(publicDocTitle("Invoice", undefined)).toBe("Invoice");
  });
});
