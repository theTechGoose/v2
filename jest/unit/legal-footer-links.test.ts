/**
 * REQ-067 — Hans, 2026-10-05: "we need these hyper links: Terms of Service |
 * Refund & Cancellation Policy | Privacy Policy | SMS Terms & Conditions —
 * Every page of the websites · On the Contact us page inquiry page · Footer
 * of DocuMonster software".
 *
 * REQ-076 — Raphael, 2026-10-15, on RingCentral's DCA rejection of campaign
 * CT8KJVQ (code 7102: "the link or attachment used to analyze the privacy
 * policy does not appear to show an actual privacy policy" — the footer's one
 * "Terms & Policies" link landed on the Terms of Service, with the Privacy
 * Policy a tab away): "i guess we have to go back to the broken out links
 * cant have it tabbed". So every footer carries the four links again, each
 * straight to its own page, from the one list (shared/legal/terms.ts
 * LEGAL_LINKS), and the policies page has no tabs: the document stands alone
 * under the website's header. The one-link / tabs amendment of 2026-10-09 is
 * withdrawn — its symbol, its labels and its styles are gone (REQ-281).
 *
 * These tests pin that the SiteFooter every app page ends with and the two
 * websites' own footers render the four, that no page spells a policy path by
 * hand, that the labels exist in every dictionary the pages read, and that
 * nothing of the one link or the tabs is left.
 */
import * as fs from "fs";
import * as path from "path";
import * as terms from "../../shared/legal/terms";
import { LANDING_DICT } from "../../front-end/lib/landing-dict";

const { LEGAL_LINKS } = terms;

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

const FOOTERS = [
  "front-end/components/SiteFooter.tsx",
  "front-end/routes/index.tsx",
  "front-end/routes/landing.tsx",
];

const LABELS = {
  en: ["Terms of Service", "Refund & Cancellation Policy", "Privacy Policy", "SMS Terms & Conditions"],
  es: ["Términos de servicio", "Política de reembolsos y cancelaciones", "Política de privacidad", "Términos y condiciones de SMS"],
};

describe("REQ-076 the policy links are broken out again: four links in every footer, no tabs on the page", () => {
  it("REQ-076 every footer carries the four policy links, in Hans's order, from the one list — straight to their own pages", () => {
    expect(LEGAL_LINKS.map((l) => l.path)).toEqual(["/terms", "/refund-policy", "/privacy", "/sms-terms"]);
    // the three footers render LEGAL_LINKS — not a hand-written link, not one link
    for (const file of FOOTERS) {
      const src = read(file);
      expect(src).toMatch(/LEGAL_LINKS\.map/);
      expect(src).toMatch(/data-legal-link=\{l\.id\}/);
      expect(src).not.toMatch(/LEGAL_FOOTER_LINK/);
      expect(src).not.toMatch(/data-legal-footer-link/);
      expect(src).not.toMatch(/href="\/terms"/);
    }
    // REQ-043's hook stays on the Terms link
    expect(read("front-end/components/SiteFooter.tsx")).toMatch(/data-terms-link=\{l\.id === "terms" \? "" : undefined\}/);
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

  it("REQ-076 the policies page has no tabs: the document stands alone under the header, and nothing of the one link or the tabs is left", () => {
    const page = read("front-end/components/LegalPage.tsx");
    expect(page).not.toMatch(/data-legal-nav/);
    expect(page).not.toMatch(/LEGAL_LINKS\.map/);
    expect(page).not.toMatch(/legal__tabs/);
    expect(page).toMatch(/<SiteFooter/);
    expect(read("front-end/static/legal.css")).not.toMatch(/legal__tabs|legal__nav/);
    // the one-link symbol is gone from the list and from every site file
    expect((terms as Record<string, unknown>).LEGAL_FOOTER_LINK).toBeUndefined();
    expect(read("shared/legal/terms.ts")).not.toContain("LEGAL_FOOTER_LINK");
    const leftovers: string[] = [];
    for (const file of siteFiles()) {
      const src = fs.readFileSync(file, "utf8");
      for (const needle of ["LEGAL_FOOTER_LINK", "data-legal-footer-link", "data-legal-nav", "legal__tabs", "footer.legal", "footerLegal\"", "docsAria"]) {
        if (src.includes(needle)) leftovers.push(`${path.relative(ROOT, file)}: ${needle}`);
      }
    }
    expect(leftovers).toEqual([]);
  });

  it("REQ-076 the four labels exist in every dictionary the footers read, and the one-link labels are gone", () => {
    // the SiteFooter (every app page, the contact card, the legal pages)
    expect(LEGAL_LINKS.map((l) => en[l.labelKey])).toEqual(LABELS.en);
    expect(LEGAL_LINKS.map((l) => es[l.labelKey])).toEqual(LABELS.es);
    // the website "/" (lib/landing-dict.ts), server render and the client-side swap alike
    const landingKeys = LEGAL_LINKS.map((l) => `footer.${l.id}`);
    expect(landingKeys.map((k) => LANDING_DICT.en[k])).toEqual(LABELS.en);
    expect(landingKeys.map((k) => LANDING_DICT.es[k])).toEqual(LABELS.es);
    expect(landingKeys.map((k) => en[`landing.${k}`])).toEqual(LABELS.en);
    expect(landingKeys.map((k) => es[`landing.${k}`])).toEqual(LABELS.es);
    const scripts = read("front-end/islands/LandingScripts.tsx");
    for (const k of landingKeys) expect(scripts).toContain(`"${k}"`);
    // the promo website "/landing" (promoLanding.*), with the nav's label
    const promoKeys = ["promoLanding.footerTerms", "promoLanding.footerRefunds", "promoLanding.footerPrivacy", "promoLanding.footerSms"];
    expect(promoKeys.map((k) => en[k])).toEqual(LABELS.en);
    expect(promoKeys.map((k) => es[k])).toEqual(LABELS.es);
    expect(en["promoLanding.footerLegalAria"]).toBe("Policies");
    expect(es["promoLanding.footerLegalAria"]).toBe("Políticas");
    // the one-link labels and the tabs' aria label left with them
    for (const k of ["siteFooter.legal", "landing.footer.legal", "promoLanding.footerLegal", "legal.docsAria"]) {
      expect(en[k]).toBeUndefined();
      expect(es[k]).toBeUndefined();
    }
    expect(LANDING_DICT.en["footer.legal"]).toBeUndefined();
    expect(LANDING_DICT.es["footer.legal"]).toBeUndefined();
  });
});
