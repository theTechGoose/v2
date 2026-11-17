/**
 * REQ-746 — demo-loop cycle 5, issue c1-p15-18 "No Agreements item in the Billing folder".
 *
 * Since the quote+contract merge the quote IS the agreement (accepting it signs it and bills it),
 * and the app calls the document "Quote + Agreement" everywhere — but the sidebar item and the
 * /quotes page said only "Quotes", so an owner looking for their agreements had nothing leading
 * there. And the owner's accepted alert said "Next step: send the agreement or invoice" after the
 * customer had already signed it (the accept emails the signed agreement + the invoice itself).
 *
 *   - nav.quotes (sidebar, Billing folder, and the /quotes topbar title) reads
 *     "Quotes & agreements" / "Cotizaciones y acuerdos";
 *   - the /quotes browser-tab title says the same;
 *   - the accepted alert (email body, CTA, SMS — lang JSON and the shared SMS builder)
 *     never asks the owner to send the agreement, and says it is signed.
 */
import { buildAcceptedAlertSms } from "../../shared/quote-flow/sms-i18n";

const en: Record<string, string> = require("../../lang/en.json");
const es: Record<string, string> = require("../../lang/es.json");

const SEND_AGREEMENT = {
  en: /send the agreement/i,
  es: /env[ií]a el (contrato|acuerdo)/i,
};

describe("REQ-746 (cycle 5, c1-p15-18) the quotes item says it holds the agreements", () => {
  test("REQ-746 nav.quotes names agreements in en and es", () => {
    expect(en["nav.quotes"]).toBe("Quotes & agreements");
    expect(es["nav.quotes"]).toBe("Cotizaciones y acuerdos");
  });

  test("REQ-746 the /quotes tab title names agreements in en and es", () => {
    expect(en["quotesPage.docTitle"]).toBe("Quotes & agreements · DocuMonster");
    expect(es["quotesPage.docTitle"]).toBe(
      "Cotizaciones y acuerdos · DocuMonster",
    );
  });
});

describe("REQ-746 (cycle 5, c1-p15-18) the accepted alert does not ask to send an already-signed agreement", () => {
  const KEYS = [
    "acceptedAlert.email.body",
    "acceptedAlert.sms.body",
    "acceptedAlert.sms.bodyJob",
  ];
  for (const lang of ["en", "es"] as const) {
    const dict = lang === "en" ? en : es;
    for (const key of KEYS) {
      test(`REQ-746 ${lang} ${key} does not say to send the agreement, and says it is signed`, () => {
        const v = dict[key] ?? "";
        expect(v).not.toMatch(SEND_AGREEMENT[lang]);
        expect(v).toMatch(lang === "en" ? /sign/i : /firm/i);
      });
    }

    test(`REQ-746 ${lang} shared SMS builder matches the dictionary and says signed`, () => {
      const plain = buildAcceptedAlertSms({
        customerName: "{name}",
        quote: {},
        url: "{url}",
        lang,
      });
      expect(plain).toBe(dict["acceptedAlert.sms.body"]);
      const withJob = buildAcceptedAlertSms({
        customerName: "{name}",
        quote: { jobName: "{job}" },
        url: "{url}",
        lang,
      });
      expect(withJob).toBe(dict["acceptedAlert.sms.bodyJob"]);
      expect(withJob).not.toMatch(SEND_AGREEMENT[lang]);
    });
  }

  test("REQ-746 the email CTA points at quotes & agreements", () => {
    expect(en["acceptedAlert.email.cta"]).toMatch(/agreements/i);
    expect(es["acceptedAlert.email.cta"]).toMatch(/acuerdos/i);
  });
});
