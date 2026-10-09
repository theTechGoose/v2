/**
 * REQ-067 — Hans, 2026-10-05: "So on the following places we need these hyper
 * links: Terms of Service | Refund & Cancellation Policy | Privacy Policy |
 * SMS Terms & Conditions — Every page of the websites · On the Contact us page
 * inquiry page · Footer of DocuMonster software".
 *
 * The four links come from ONE list (shared/legal/terms.ts LEGAL_LINKS): the
 * SiteFooter every app page ends with renders it, and so do the two websites'
 * own footers. These tests pin that no page spells a policy path by hand and
 * that every footer label exists in every dictionary the pages read.
 */
import * as fs from "fs";
import * as path from "path";
import { LEGAL_LINKS } from "../../shared/legal/terms";
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

describe("REQ-067 the footer and both websites link all four policies, in order, from the one list", () => {
  it("REQ-067 the footer and both websites link all four policies, in order, from the one list", () => {
    expect(LEGAL_LINKS.map((l) => l.path)).toEqual(["/terms", "/refund-policy", "/privacy", "/sms-terms"]);
    // the three footers render LEGAL_LINKS — not a hand-written Terms link
    for (const file of [
      "front-end/components/SiteFooter.tsx",
      "front-end/routes/index.tsx",
      "front-end/routes/landing.tsx",
    ]) {
      const src = read(file);
      expect(src).toMatch(/LEGAL_LINKS/);
      expect(src).not.toMatch(/href="\/terms"/);
    }
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

  it("REQ-067 every footer label exists in every dictionary the pages read", () => {
    // the SiteFooter (every app page, the contact card, the legal pages)
    for (const l of LEGAL_LINKS) {
      expect(en[l.labelKey]).toBeTruthy();
      expect(es[l.labelKey]).toBeTruthy();
    }
    // the website "/" (lib/landing-dict.ts) and the promo website "/landing" (promoLanding.*)
    const landingKeys = ["footer.terms", "footer.refunds", "footer.privacy", "footer.sms"];
    expect(landingKeys.map((k) => LANDING_DICT.en[k])).toEqual(LEGAL_LINKS.map((l) => en[l.labelKey]));
    expect(landingKeys.map((k) => LANDING_DICT.es[k])).toEqual(LEGAL_LINKS.map((l) => es[l.labelKey]));
    const promoKeys = ["promoLanding.footerTerms", "promoLanding.footerRefunds", "promoLanding.footerPrivacy", "promoLanding.footerSms"];
    expect(promoKeys.map((k) => en[k])).toEqual(LEGAL_LINKS.map((l) => en[l.labelKey]));
    expect(promoKeys.map((k) => es[k])).toEqual(LEGAL_LINKS.map((l) => es[l.labelKey]));
  });
});
