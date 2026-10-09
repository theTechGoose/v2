/**
 * REQ-067 — Hans, 2026-10-05: "we need these hyper links: Terms of Service |
 * Refund & Cancellation Policy | Privacy Policy | SMS Terms & Conditions —
 * Every page of the websites · On the Contact us page inquiry page · Footer
 * of DocuMonster software". Raphael, 2026-10-09: "it needs to be one link
 * with a page that has multiple tabs."
 *
 * So every footer carries ONE "Terms & Policies" link (shared/legal/terms.ts
 * LEGAL_FOOTER_LINK) to the policies page, whose tabs are the four documents
 * (LEGAL_LINKS). These tests pin that the SiteFooter every app page ends with
 * and the two websites' own footers render that one link, that no page spells
 * a policy path by hand, and that the labels exist in every dictionary the
 * pages read.
 */
import * as fs from "fs";
import * as path from "path";
import { LEGAL_FOOTER_LINK, LEGAL_LINKS, TERMS_PATH } from "../../shared/legal/terms";
import { LANDING_DICT } from "../../front-end/lib/landing-dict";

const ROOT = path.resolve(__dirname, "../..");
const SITE_DIRS = [
  "front-end/routes",
  "front-end/islands",
  "front-end/components",
  "front-end/lib",
  "front-end/static",
];
const EXT = /\.(tsx?|jsx?|css|js)$/;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "_fresh") continue;
      walk(p, out);
    } else if (EXT.test(entry.name)) out.push(p);
  }
  return out;
}
const siteFiles = () => SITE_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

describe("REQ-067 every footer carries the one policies link, and the page's tabs are the four", () => {
  it("REQ-067 every footer carries the one policies link, and the page's tabs are the four", () => {
    expect(LEGAL_FOOTER_LINK.path).toBe(TERMS_PATH);
    expect(LEGAL_LINKS.map((l) => l.path)).toEqual(["/terms", "/refund-policy", "/privacy", "/sms-terms"]);
    // the three footers render LEGAL_FOOTER_LINK — not a hand-written link, not the four
    for (const file of [
      "front-end/components/SiteFooter.tsx",
      "front-end/routes/index.tsx",
      "front-end/routes/landing.tsx",
    ]) {
      const src = read(file);
      expect(src).toMatch(/LEGAL_FOOTER_LINK/);
      expect(src).not.toMatch(/LEGAL_LINKS\.map/);
      expect(src).not.toMatch(/href="\/terms"/);
    }
    // the policies page renders the four as tabs
    expect(read("front-end/components/LegalPage.tsx")).toMatch(/LEGAL_LINKS\.map/);
    // no page in the site source spells a policy path by hand
    const offenders: string[] = [];
    for (const file of siteFiles()) {
      const src = fs.readFileSync(file, "utf8");
      for (const p of LEGAL_LINKS.map((l) => l.path)) {
        if (new RegExp(`["'\`]${p}(\\?|["'\`#])`).test(src)) offenders.push(`${path.relative(ROOT, file)}: ${p}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("REQ-067 the labels exist in every dictionary the pages read", () => {
    // the SiteFooter (every app page, the contact card, the legal pages)
    expect(en[LEGAL_FOOTER_LINK.labelKey]).toBe("Terms & Policies");
    expect(es[LEGAL_FOOTER_LINK.labelKey]).toBe("Términos y políticas");
    // the website "/" (lib/landing-dict.ts) and the promo website "/landing" (promoLanding.*)
    expect(LANDING_DICT.en["footer.legal"]).toBe("Terms & Policies");
    expect(LANDING_DICT.es["footer.legal"]).toBe("Términos y políticas");
    expect(en["promoLanding.footerLegal"]).toBe("Terms & Policies");
    expect(es["promoLanding.footerLegal"]).toBe("Términos y políticas");
    // the four tabs' labels
    for (const l of LEGAL_LINKS) {
      expect(en[l.labelKey]).toBeTruthy();
      expect(es[l.labelKey]).toBeTruthy();
    }
    // the four-link keys left with the four links
    for (const k of ["footer.terms", "footer.refunds", "footer.privacy", "footer.sms"]) {
      expect(LANDING_DICT.en[k]).toBeUndefined();
    }
    for (const k of ["promoLanding.footerRefunds", "promoLanding.footerPrivacy", "promoLanding.footerSms"]) {
      expect(en[k]).toBeUndefined();
    }
  });
});
