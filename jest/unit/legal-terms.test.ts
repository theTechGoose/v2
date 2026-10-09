/**
 * REQ-043 — "link it to html that renders something like this": the legal
 * documents live in ONE pure data module the legal pages render.
 * REQ-065 — Hans, 2026-10-05: "we have updated everything in this document to
 * DocuMosnter Powered by Paperwork Monster … See attached" — the October 6,
 * 2026 document replaces the September text (Last Updated, DocuMonster Powered
 * by Paperwork Monster, the filled-in contact details) and adds a FOURTH
 * document, the SMS Terms & Conditions, in both languages.
 * REQ-066 — each document is its own page: the module names every path.
 *
 * These tests pin that the module carries the client's text faithfully —
 * every numbered section, the arbitration notice, the bullet lists — and that
 * the footer labels exist in both dictionaries.
 */
import {
  LEGAL_DOCS,
  LEGAL_LAST_UPDATED,
  LEGAL_LINKS,
  legalDocsFor,
  legalPathFor,
  PRIVACY_POLICY,
  REFUND_POLICY,
  SMS_TERMS,
  TERMS_OF_SERVICE,
  TERMS_PATH,
} from "../../shared/legal/terms";
import { LEGAL_DOCS_ES, LEGAL_LAST_UPDATED_ES } from "../../shared/legal/terms.es";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const BRAND_LINE =
  'doing business as DocuMonster Powered by Paperwork Monster ("DocuMonster," "we," "us," or "our")';
const CONTACT_LINE = "hello@documonster.com, 855-DOCUMON (855-362-8666), or 4505 Socastee Blvd, Myrtle Beach, SC 29588. Website: www.DocuMonster.com.";

/** every string the document carries, in order */
function allText(doc: typeof TERMS_OF_SERVICE): string[] {
  const out: string[] = [doc.title, doc.lastUpdated, ...(doc.notice ? [doc.notice] : []), ...doc.intro];
  for (const s of doc.sections) {
    out.push(s.heading);
    for (const b of s.blocks) {
      if (b.kind === "list") out.push(...b.items);
      else if (b.kind === "labeled") out.push(b.label, b.text);
      else out.push(b.text);
    }
  }
  return out;
}

describe("REQ-065 the legal data module carries the October 6, 2026 documents verbatim", () => {
  it("REQ-065 four documents, in order, all last updated October 6, 2026, DocuMonster Powered by Paperwork Monster", () => {
    expect(LEGAL_DOCS.map((d) => d.id)).toEqual(["terms", "refunds", "privacy", "sms"]);
    expect(LEGAL_DOCS.map((d) => d.title)).toEqual([
      "Terms of Service",
      "Refund & Cancellation Policy",
      "Privacy Policy",
      "SMS Terms & Conditions",
    ]);
    expect(LEGAL_LAST_UPDATED).toBe("October 6, 2026");
    for (const d of LEGAL_DOCS) expect(d.lastUpdated).toBe("October 6, 2026");
    // the brand line opens the Terms, the Privacy Policy and the SMS Terms (the
    // Refund Policy's intro is "This Policy forms part of our Terms of Service.")
    for (const d of [TERMS_OF_SERVICE, PRIVACY_POLICY, SMS_TERMS]) {
      expect(d.intro[0]).toContain("Paperwork Monster Inc., " + BRAND_LINE);
    }
    expect(REFUND_POLICY.intro[0]).toMatch(/This Policy forms part of our Terms of Service\.$/);
    // every document ends on the filled-in contact details (the Refund Policy's last
    // section keeps its "How to Request Help" heading; Terms and Refund keep the older
    // paragraph above the new one, as the document does)
    for (const d of LEGAL_DOCS) {
      const last = d.sections[d.sections.length - 1];
      expect(last.heading).toBe(d.id === "refunds" ? "How to Request Help With a Billing Issue" : "Contact Us");
      const text = last.blocks.map((b) => (b.kind === "list" ? b.items.join(" ") : b.text)).join("\n");
      expect(text).toContain(CONTACT_LINE);
    }
  });

  it("REQ-065 the September text is gone: no Effective Date, no 'doing business as Paperwork Monster', no email placeholder", () => {
    for (const d of LEGAL_DOCS) {
      for (const s of allText(d)) {
        expect(s).not.toMatch(/\[INSERT/);
        expect(s).not.toMatch(/doing business as Paperwork Monster\b(?! Inc)/);
        expect(s).not.toMatch(/\("Paperwork Monster,"/);
        expect(s).not.toMatch(/Effective Date/);
        expect(s).not.toMatch(/September 24, 2026/);
      }
    }
    // "Paperwork Monster" survives only as the legal entity and in the brand line
    for (const d of LEGAL_DOCS) {
      for (const s of allText(d)) {
        const stripped = s.replace(/Paperwork Monster Inc\./g, "").replace(/DocuMonster Powered by Paperwork Monster/g, "");
        expect(stripped).not.toMatch(/Paperwork Monster/);
      }
    }
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
    expect(headings[10]).toBe("Text Messages, Calls, Emails, and Customer Communications");
    expect(headings[30]).toBe("Contact Us");
    expect(TERMS_OF_SERVICE.sections[30].blocks.map((b) => b.kind)).toEqual(["p", "p"]);
    // §15 is the one bullet list in the Terms: 12 prohibited uses.
    const acceptable = TERMS_OF_SERVICE.sections[14].blocks.find((b) => b.kind === "list");
    expect(acceptable && acceptable.kind === "list" ? acceptable.items.length : 0).toBe(12);
    // §22/§23/§28 are the all-caps clauses — kept in caps as written.
    for (const n of [22, 23, 28]) {
      const first = TERMS_OF_SERVICE.sections[n - 1].blocks[0];
      expect(first.kind).toBe("p");
      if (first.kind === "p") expect(first.text).toBe(first.text.toUpperCase());
    }
    // REQ-065: §26 Notices names the address and the email (no placeholder left)
    const s26 = TERMS_OF_SERVICE.sections[25].blocks[1];
    expect(s26.kind === "p" && s26.text).toBe(
      "Notices to DocuMonster should be sent to: DocuMonster, 4505 Socastee Blvd, Myrtle Beach, SC 29588; email: hello@documonster.com.",
    );
  });

  it("REQ-043 Refund & Cancellation Policy: 13 numbered sections", () => {
    expect(REFUND_POLICY.notice).toBeUndefined();
    expect(REFUND_POLICY.sections.map((s) => s.n)).toEqual(
      Array.from({ length: 13 }, (_, i) => i + 1),
    );
    expect(REFUND_POLICY.sections[0].heading).toBe("Recurring Subscriptions");
    expect(REFUND_POLICY.sections[6].heading).toBe("No Prorated Refunds");
    expect(REFUND_POLICY.sections[12].heading).toBe("How to Request Help With a Billing Issue");
    expect(REFUND_POLICY.sections[12].blocks.map((b) => b.kind)).toEqual(["p", "p"]);
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
    // REQ-065: §5 is the texting section now, three paragraphs
    expect(PRIVACY_POLICY.sections[4].heading).toBe("SMS, Mobile Information, Phone Calls, and Email");
    expect(PRIVACY_POLICY.sections[4].blocks.map((b) => b.kind)).toEqual(["p", "p", "p"]);
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

  it("REQ-065 SMS Terms & Conditions: 10 numbered sections and the 7 message types, in both languages", () => {
    expect(SMS_TERMS.id).toBe("sms");
    expect(SMS_TERMS.notice).toBeUndefined();
    expect(SMS_TERMS.intro).toHaveLength(1);
    expect(SMS_TERMS.intro[0]).toMatch(/^These SMS Terms & Conditions \("SMS Terms"\)/);
    expect(SMS_TERMS.intro[0]).toMatch(/supplement our Terms of Service and Privacy Policy\.$/);
    expect(SMS_TERMS.sections.map((s) => s.n)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    expect(SMS_TERMS.sections.map((s) => s.heading)).toEqual([
      "SMS Program Overview",
      "Consent for SMS Communications",
      "Types of SMS Communications",
      "Opt-In Methods",
      "Message Frequency, Charges, STOP, and HELP",
      "Privacy of SMS Consent and Mobile Information",
      "Business Customers Using DocuMonster Messaging",
      "Delivery and Carrier Availability",
      "Changes to These SMS Terms",
      "Contact Us",
    ]);
    const types = SMS_TERMS.sections[2].blocks;
    expect(types.map((b) => b.kind)).toEqual(["p", "list"]);
    expect(types[1].kind === "list" ? types[1].items.length : 0).toBe(7);
    expect(types[1].kind === "list" && types[1].items[0]).toBe("account, onboarding, verification, or support messages;");
    // §5 carries the STOP / HELP instructions with the support line
    const stop = SMS_TERMS.sections[4].blocks[1];
    expect(stop.kind === "p" && stop.text).toContain("replying STOP");
    expect(stop.kind === "p" && stop.text).toContain("reply HELP where supported, call 855-DOCUMON (855-362-8666), or email hello@documonster.com");
    // the Spanish twin
    const sms = LEGAL_DOCS_ES[3];
    expect(sms.id).toBe("sms");
    expect(sms.title).toBe("Términos y condiciones de SMS");
    expect(sms.sections.map((s) => s.n)).toEqual(SMS_TERMS.sections.map((s) => s.n));
    const typesEs = sms.sections[2].blocks[1];
    expect(typesEs.kind === "list" ? typesEs.items.length : 0).toBe(7);
    const stopEs = sms.sections[4].blocks[1];
    expect(stopEs.kind === "p" && stopEs.text).toContain("STOP");
    expect(stopEs.kind === "p" && stopEs.text).toContain("855-DOCUMON (855-362-8666)");
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
});

describe("REQ-066 each document is its own page", () => {
  it("REQ-066 the four documents each have a path and a footer label in both dictionaries", () => {
    expect(LEGAL_LINKS.map((l) => l.id)).toEqual(["terms", "refunds", "privacy", "sms"]);
    expect(LEGAL_LINKS.map((l) => l.path)).toEqual(["/terms", "/refund-policy", "/privacy", "/sms-terms"]);
    expect(TERMS_PATH).toBe("/terms");
    expect(legalPathFor("terms")).toBe("/terms");
    expect(legalPathFor("refunds")).toBe("/refund-policy");
    expect(legalPathFor("privacy")).toBe("/privacy");
    expect(legalPathFor("sms")).toBe("/sms-terms");
    expect(LEGAL_LINKS.map((l) => en[l.labelKey])).toEqual([
      "Terms of Service",
      "Refund & Cancellation Policy",
      "Privacy Policy",
      "SMS Terms & Conditions",
    ]);
    expect(LEGAL_LINKS.map((l) => es[l.labelKey])).toEqual([
      "Términos de servicio",
      "Política de reembolsos y cancelaciones",
      "Política de privacidad",
      "Términos y condiciones de SMS",
    ]);
    // the label is the document's own title, so the footer and the page agree
    for (const l of LEGAL_LINKS) {
      expect(en[l.labelKey]).toBe(LEGAL_DOCS.find((d) => d.id === l.id)!.title);
      expect(es[l.labelKey]).toBe(LEGAL_DOCS_ES.find((d) => d.id === l.id)!.title);
    }
    // the page chrome reads "Last Updated" in both languages; "Effective Date" left with the September text
    expect(en["legal.lastUpdated"]).toBe("Last Updated");
    expect(es["legal.lastUpdated"]).toBe("Última actualización");
    expect(en["legal.effectiveDate"]).toBeUndefined();
    expect(es["legal.effectiveDate"]).toBeUndefined();
  });
});

// REQ-043 amendment: "this is in english only. it should be both"
describe("REQ-043 the Spanish documents mirror the English structure", () => {
  it("REQ-043 same four documents, ids, titles in Spanish, last-updated date in Spanish", () => {
    expect(LEGAL_DOCS_ES.map((d) => d.id)).toEqual(["terms", "refunds", "privacy", "sms"]);
    expect(LEGAL_DOCS_ES.map((d) => d.title)).toEqual([
      "Términos de servicio",
      "Política de reembolsos y cancelaciones",
      "Política de privacidad",
      "Términos y condiciones de SMS",
    ]);
    expect(LEGAL_LAST_UPDATED_ES).toBe("6 de octubre de 2026");
    for (const d of LEGAL_DOCS_ES) expect(d.lastUpdated).toBe("6 de octubre de 2026");
    expect(LEGAL_DOCS_ES[0].notice).toMatch(/^ESTE ACUERDO ESTÁ SUJETO A ARBITRAJE/);
    expect(LEGAL_DOCS_ES[1].notice).toBeUndefined();
    // REQ-065: the Spanish carries the brand line too, and nothing of the September text
    for (const d of [LEGAL_DOCS_ES[0], LEGAL_DOCS_ES[2], LEGAL_DOCS_ES[3]]) {
      expect(d.intro[0]).toContain('que opera como DocuMonster Powered by Paperwork Monster ("DocuMonster,"');
    }
    for (const d of LEGAL_DOCS_ES) {
      for (const s of allText(d)) {
        expect(s).not.toMatch(/\[INSERTAR/);
        expect(s).not.toMatch(/24 de septiembre de 2026/);
        const stripped = s.replace(/Paperwork Monster Inc\./g, "").replace(/DocuMonster Powered by Paperwork Monster/g, "");
        expect(stripped).not.toMatch(/Paperwork Monster/);
      }
    }
  });

  it("REQ-043 every section, block kind, list length and labeled block matches the English one-to-one", () => {
    expect(LEGAL_DOCS_ES.length).toBe(LEGAL_DOCS.length);
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

  it("REQ-043 legalDocsFor picks the language", () => {
    expect(legalDocsFor("en")).toBe(LEGAL_DOCS);
    expect(legalDocsFor("es")).toBe(LEGAL_DOCS_ES);
  });
});
