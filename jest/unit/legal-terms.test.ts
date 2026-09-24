/**
 * REQ-043 — "link it to html that renders something like this": the three
 * legal documents (Terms of Service, Refund & Cancellation Policy, Privacy
 * Policy, all effective September 24, 2026) live in ONE pure data module
 * that /terms renders. These tests pin that the module carries the client's
 * text faithfully — every numbered section, the arbitration notice, the
 * bullet lists — and that the footer link has a label in both dictionaries.
 */
import {
  LEGAL_DOCS,
  LEGAL_EFFECTIVE_DATE,
  PRIVACY_POLICY,
  REFUND_POLICY,
  TERMS_OF_SERVICE,
  TERMS_PATH,
} from "../../shared/legal/terms";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

describe("REQ-043 the legal data module carries the three documents verbatim", () => {
  it("REQ-043 three documents, in order, all effective September 24, 2026", () => {
    expect(LEGAL_DOCS.map((d) => d.id)).toEqual(["terms", "refunds", "privacy"]);
    expect(LEGAL_DOCS.map((d) => d.title)).toEqual([
      "Terms of Service",
      "Refund & Cancellation Policy",
      "Privacy Policy",
    ]);
    expect(LEGAL_EFFECTIVE_DATE).toBe("September 24, 2026");
    for (const d of LEGAL_DOCS) expect(d.effectiveDate).toBe("September 24, 2026");
    expect(TERMS_PATH).toBe("/terms");
  });

  it("REQ-043 Terms of Service: the arbitration notice and 31 numbered sections", () => {
    expect(TERMS_OF_SERVICE.notice).toBe(
      "THIS AGREEMENT IS SUBJECT TO ARBITRATION PURSUANT TO THE SOUTH CAROLINA UNIFORM ARBITRATION ACT.",
    );
    expect(TERMS_OF_SERVICE.intro[0]).toMatch(/^These Terms of Service \("Terms"\)/);
    expect(TERMS_OF_SERVICE.intro[1]).toMatch(/If you do not agree, do not access or use the Services\.$/);
    expect(TERMS_OF_SERVICE.sections.map((s) => s.n)).toEqual(
      Array.from({ length: 31 }, (_, i) => i + 1),
    );
    const headings = TERMS_OF_SERVICE.sections.map((s) => s.heading);
    expect(headings[0]).toBe("Business-to-Business Service");
    expect(headings[3]).toBe("Monster Free and Free Trials");
    expect(headings[14]).toBe("Acceptable Use");
    expect(headings[26]).toBe("Binding Arbitration");
    expect(headings[27]).toBe("Class Action and Jury Trial Waiver");
    expect(headings[30]).toBe("Contact Us");
    // §15 is the one bullet list in the Terms: 12 prohibited uses.
    const acceptable = TERMS_OF_SERVICE.sections[14].blocks.find((b) => b.kind === "list");
    expect(acceptable && acceptable.kind === "list" ? acceptable.items.length : 0).toBe(12);
    // §22/§23/§28 are the all-caps clauses — kept in caps as written.
    for (const n of [22, 23, 28]) {
      const first = TERMS_OF_SERVICE.sections[n - 1].blocks[0];
      expect(first.kind).toBe("p");
      if (first.kind === "p") expect(first.text).toBe(first.text.toUpperCase());
    }
    // The mailing address is filled in (§26); the email placeholders stay as written.
    const s26 = TERMS_OF_SERVICE.sections[25].blocks[1];
    expect(s26.kind === "p" && s26.text).toContain("4505 Socastee Blvd, Myrtle Beach, SC 29588");
  });

  it("REQ-043 Refund & Cancellation Policy: 13 numbered sections", () => {
    expect(REFUND_POLICY.notice).toBeUndefined();
    expect(REFUND_POLICY.intro[0]).toMatch(/This Policy forms part of our Terms of Service\.$/);
    expect(REFUND_POLICY.sections.map((s) => s.n)).toEqual(
      Array.from({ length: 13 }, (_, i) => i + 1),
    );
    expect(REFUND_POLICY.sections[0].heading).toBe("Recurring Subscriptions");
    expect(REFUND_POLICY.sections[6].heading).toBe("No Prorated Refunds");
    expect(REFUND_POLICY.sections[12].heading).toBe("How to Request Help With a Billing Issue");
  });

  it("REQ-043 Privacy Policy: 18 numbered sections, labeled sub-blocks and the 20 uses", () => {
    expect(PRIVACY_POLICY.sections.map((s) => s.n)).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 1),
    );
    const collect = PRIVACY_POLICY.sections[0];
    expect(collect.heading).toBe("Information We Collect");
    expect(collect.blocks.map((b) => (b.kind === "labeled" ? b.label : b.kind))).toEqual([
      "Account and Business Information",
      "Billing and Transaction Information",
      "Customer and CRM Information",
      "Business Documents",
      "Communications",
      "Device and Usage Information",
    ]);
    const uses = PRIVACY_POLICY.sections[1].blocks.find((b) => b.kind === "list");
    expect(uses && uses.kind === "list" ? uses.items.length : 0).toBe(20);
    const disclose = PRIVACY_POLICY.sections[5];
    expect(disclose.heading).toBe("How We Disclose Information");
    expect(disclose.blocks.map((b) => (b.kind === "labeled" ? b.label : b.kind))).toEqual([
      "Service Providers",
      "At Your Direction",
      "Business Transactions",
      "Legal and Safety Purposes",
    ]);
    expect(PRIVACY_POLICY.sections[17].heading).toBe("Contact Us");
  });

  it("REQ-043 every section has text and no block is empty", () => {
    for (const d of LEGAL_DOCS) {
      for (const s of d.sections) {
        expect(s.heading.trim().length).toBeGreaterThan(0);
        expect(s.blocks.length).toBeGreaterThan(0);
        for (const b of s.blocks) {
          if (b.kind === "list") {
            expect(b.items.length).toBeGreaterThan(0);
            for (const it of b.items) expect(it.trim().length).toBeGreaterThan(0);
          } else expect(b.text.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("REQ-043 the footer link label exists in both dictionaries", () => {
    expect(en["siteFooter.terms"]).toBe("Terms of Service");
    expect(es["siteFooter.terms"]).toBe("Términos de servicio");
    // The two landings substitute their footer copy through data-i18n keys.
    expect(en["landing.footer.terms"]).toBe("Terms of Service");
    expect(es["landing.footer.terms"]).toBe("Términos de servicio");
    expect(en["promoLanding.footerTerms"]).toBe("Terms of Service");
    expect(es["promoLanding.footerTerms"]).toBe("Términos de servicio");
  });
});

// REQ-043 amendment: "this is in english only. it should be both"
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { LEGAL_DOCS_ES } from "../../shared/legal/terms.es";
import { legalDocsFor } from "../../shared/legal/terms";

describe("REQ-043 the Spanish documents mirror the English structure", () => {
  it("REQ-043 same three documents, ids, titles in Spanish, effective date in Spanish", () => {
    expect(LEGAL_DOCS_ES.map((d) => d.id)).toEqual(["terms", "refunds", "privacy"]);
    expect(LEGAL_DOCS_ES.map((d) => d.title)).toEqual([
      "Términos de servicio",
      "Política de reembolsos y cancelaciones",
      "Política de privacidad",
    ]);
    for (const d of LEGAL_DOCS_ES) expect(d.effectiveDate).toBe("24 de septiembre de 2026");
    expect(LEGAL_DOCS_ES[0].notice).toMatch(/^ESTE ACUERDO ESTÁ SUJETO A ARBITRAJE/);
    expect(LEGAL_DOCS_ES[1].notice).toBeUndefined();
  });

  it("REQ-043 every section, block kind, list length and labeled block matches the English one-to-one", () => {
    for (let d = 0; d < LEGAL_DOCS.length; d++) {
      const en = LEGAL_DOCS[d];
      const es = LEGAL_DOCS_ES[d];
      expect(es.intro.length).toBe(en.intro.length);
      expect(es.sections.map((s) => s.n)).toEqual(en.sections.map((s) => s.n));
      for (let i = 0; i < en.sections.length; i++) {
        const a = en.sections[i];
        const b = es.sections[i];
        expect(b.heading.trim().length).toBeGreaterThan(0);
        expect(b.blocks.map((x) => x.kind)).toEqual(a.blocks.map((x) => x.kind));
        for (let k = 0; k < a.blocks.length; k++) {
          const x = a.blocks[k];
          const y = b.blocks[k];
          if (x.kind === "list" && y.kind === "list") {
            expect(y.items.length).toBe(x.items.length);
          } else if (x.kind !== "list" && y.kind !== "list") {
            expect(y.text.trim().length).toBeGreaterThan(0);
            expect(y.text).not.toBe(x.text);
          }
        }
      }
    }
  });

  it("REQ-043 legalDocsFor picks the language; the page chrome has both labels", () => {
    expect(legalDocsFor("en")).toBe(LEGAL_DOCS);
    expect(legalDocsFor("es")).toBe(LEGAL_DOCS_ES);
    expect(en["legal.effectiveDate"]).toBe("Effective Date");
    expect(es["legal.effectiveDate"]).toBe("Fecha de vigencia");
  });
});
