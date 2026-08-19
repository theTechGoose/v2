/// <reference types="cypress" />

/**
 * RED (TDD) — UX-38 + UX-39 + UX-40: the Spanish customer-facing /c page and
 * the ES /invoices hero.
 *
 *   UX-38 "English-formatted dates throughout the Spanish /c page." —
 *         "vigente August 18, 2026", "Fecha: August 18, 2026", the signed
 *         badge "FIRMADO AUGUST 18, 2026", the signature timestamp; and the
 *         ES /invoices hero short date "Aug 25: …" (desired "25 ago").
 *   UX-39 "The post-sign confirmation promises an email to a customer who
 *         has none." — "revisar tu correo… revisar el spam" for a customer
 *         with no email on file; the copy must adapt to the real channel
 *         (text/SMS).
 *   UX-40 "/c browser-tab title is English" on the Spanish contract.
 *
 * Selector grounding (read on 2026-08-19):
 *   - /c route: front-end/routes/c/[id].tsx — lang from the pm_lang cookie
 *     (:17); the tab title is HARDCODED "Quote + Agreement · Paperwork
 *     Monster" (:22). Precedent for the fix: routes/i/[id].tsx:115 and
 *     routes/co/[id].tsx:57 use tFor(lang, "….docTitle").
 *   - /c dates: front-end/components/contract-doc.tsx calls the lang-aware
 *     doc-parts fmtDate WITHOUT the lang argument at :268 ("Fecha:" line),
 *     :333 (signed pill "Firmado {date}"), :372 (the "vigente" line in the
 *     between-parties row) and :570 (signature timestamp) — every one
 *     defaults to en-US. The pure fix target is pinned in
 *     jest/unit/ux-es-dates.test.ts.
 *   - Signature pad flow: front-end/islands/PublicSignContract.tsx — name
 *     input :437-445, submit button label publicSign.submitEnabled
 *     ("Firmar el contrato →") :493-497; on success the island reloads after
 *     900ms (:268-272) and the SIGNED page renders contract-doc.tsx:606-637:
 *     "Firmado y vinculante" (contractDoc.signedBinding) + the note
 *     (contractDoc.signedNote — the broken "revisar tu correo… spam" copy,
 *     lang/es.json). "Ambas firmas capturadas." (contractDoc.bothCaptured,
 *     :500) renders ONLY in the signed state — used as the post-reload gate.
 *   - /invoices hero: front-end/islands/InvoicesPage.tsx:639
 *     (data-cy="forecast-hero") + :699-707 (data-cy="forecast-breakdown"
 *     renders shortDay(e.expectedLandDate)); shortDay (:101-113) hardcodes
 *     toLocaleDateString("en-US") in BOTH branches (weekday <7d, "MMM d"
 *     otherwise) — so whichever branch fires, the ES page shows an en-US
 *     token today. The ES short-month table the fix must agree with is
 *     lang/es.json invoicesPage.month.* (ene…dic — already used by the
 *     invoice CARDS at :115-127, which are correctly localized).
 *
 * Phones used (this file only): +15125556630 (contractor), +15125556631
 * (customer — deliberately NO email, for UX-39).
 */

// Module scope (export {} at the bottom) so these consts can't collide with
// other specs — cy files without imports compile as global scripts.
const PHONE = "+15125556630";
const CUSTOMER_NAME = "Paula Ibarra";
const JOB = "Terraza Nueva";
const TOTAL_CENTS = 250000;

// en-US long form ("August 18, 2026") — capitalized months make this
// case-sensitive check unambiguous against Spanish text.
const EN_LONG =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/;
// Desired ES long form ("18 de agosto de 2026").
const ES_LONG =
  /\b\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) de \d{4}\b/;

describe("UX-38/39/40 — Spanish /c page + ES /invoices hero", () => {
  let customerId: string;
  let quoteId: string;
  let contractId: string;

  before(() => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "es", name: "Marisol Vega" });
    // commsLanguage es → the customer document is Spanish even without the
    // pm_lang cookie; the tests set the cookie too for determinism.
    cy.apiUpdateProfile({
      businessName: "VEGA REMODELACIONES",
      commsLanguage: "es",
    });
    // UX-39 persona: customer with a phone but NO email on file.
    cy.apiCreateCustomer({
      name: CUSTOMER_NAME,
      phoneNumber: "+15125556631",
    }).then((id: string) => {
      customerId = id;
      cy.apiCreateQuote({
        summary: "Construcción de terraza nueva",
        jobName: JOB,
        customerId: id,
        lineItems: [
          {
            description: "Terraza",
            quantity: 1,
            unit: "job",
            price: TOTAL_CENTS,
          },
        ],
        estimatedTotal: TOTAL_CENTS,
      }).then((qId: string) => {
        quoteId = qId;
        // The quote is deliberately NOT accepted here — this deal's /c
        // ceremony is legitimate (independent of the UX-37 fix), so the
        // UX-39 pad signing below stays valid.
        cy.apiCreateContract({
          quoteId: qId,
          customerId: id,
          totalAmount: TOTAL_CENTS,
          terms: [
            {
              stepId: "payment_terms",
              label: "Payment terms",
              value: "50 / 50",
            },
          ],
        }).then((cId: string) => {
          contractId = cId;
        });
      });
    });
  });

  it("UX-38: the ES /c 'vigente' line and 'Fecha:' block use '18 de agosto de 2026', never en-US", () => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.visit(`/c/${contractId}`);
    cy.contains(new RegExp(JOB, "i"), { timeout: 10_000 }).should("be.visible");

    // The between-parties row: "… · vigente <date>" (contract-doc.tsx:368-374).
    cy.contains("vigente")
      .invoke("text")
      .should((text: string) => {
        expect(text, "vigente line uses the ES long form").to.match(ES_LONG);
        expect(text, "vigente line has no en-US date").not.to.match(EN_LONG);
      });

    // The contractor-signature date line: "Fecha: <date>" (contract-doc.tsx:527-529).
    cy.contains(/fecha:/i)
      .invoke("text")
      .should((text: string) => {
        expect(text, "Fecha block uses the ES long form").to.match(ES_LONG);
        expect(text, "Fecha block has no en-US date").not.to.match(EN_LONG);
      });

    // And no en-US long date anywhere on the Spanish document.
    cy.get("body")
      .invoke("text")
      .should((text: string) => {
        expect(text, "no en-US long dates on the ES /c page").not.to.match(
          EN_LONG,
        );
      });
  });

  it("UX-39: signing without an email on file — the confirmation must not promise 'correo'/'spam'", () => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.visit(`/c/${contractId}`);

    // Sign via the real UI pad flow (public-contract-signature.cy.ts
    // precedent): type the legal name, then submit. The typed name alone is
    // enough — the island renders a cursive PNG from it.
    cy.contains(/firma y escribe tu nombre abajo/i, { timeout: 10_000 })
      .parents("section, div")
      .first()
      .find("input")
      .first()
      .type(CUSTOMER_NAME);
    cy.contains("button", /firmar el contrato/i).click();

    // The island reloads ~900ms after success; "Ambas firmas capturadas."
    // renders only on the signed page (contract-doc.tsx:500) — a stable
    // post-reload gate.
    cy.contains(/ambas firmas capturadas/i, { timeout: 15_000 }).should(
      "be.visible",
    );

    // The signed confirmation strip (contract-doc.tsx:606-637). RED today:
    // contractDoc.signedNote promises "…revisar tu correo. No olvides
    // revisar el spam." to a customer with NO email — the copy must adapt
    // to the channel that actually exists (her phone / text).
    cy.contains(/firmado y vinculante/i)
      .parent()
      .invoke("text")
      .should((text: string) => {
        expect(text, "no email promise for an email-less customer").not.to
          .match(/correo|spam/i);
        expect(text, "names the real channel (text/SMS)").to.match(
          /texto|mensaje|sms/i,
        );
      });
  });

  it("UX-38: the signed badge and signature timestamp are Spanish dates", () => {
    // Guard: ensure signed even if the UI flow above was flaky (idempotent —
    // the endpoint answers {ok:true, alreadySigned:true} on a re-sign).
    cy.apiSignContract(contractId, {
      name: CUSTOMER_NAME,
      signature: CUSTOMER_NAME,
    });
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.visit(`/c/${contractId}`);
    cy.contains(new RegExp(JOB, "i"), { timeout: 10_000 }).should("be.visible");

    cy.get("body")
      .invoke("text")
      .should((text: string) => {
        // The status pill (contract-doc.tsx:327-335): "Firmado {date}" must
        // carry the ES long form — RED today: "Firmado August 19, 2026".
        expect(text, "FIRMADO badge date is Spanish").to.match(
          new RegExp(String.raw`Firmado\s+\d{1,2} de \p{L}+ de \d{4}`, "iu"),
        );
        // No en-US long date anywhere — also covers the signature-card
        // timestamp (contract-doc.tsx:566-572).
        expect(text, "no en-US long dates on the signed ES page").not.to.match(
          EN_LONG,
        );
      });
  });

  it("UX-40: the ES /c browser-tab title is localized", () => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.visit(`/c/${contractId}`);
    // RED today: routes/c/[id].tsx:22 hardcodes the EN title. Precedent:
    // /i and /co localize via tFor(lang, "….docTitle").
    cy.title().should((title: string) => {
      expect(title).not.to.eq("Quote + Agreement · Paperwork Monster");
      expect(title, "Spanish document title").to.match(
        /cotización|acuerdo|contrato/i,
      );
    });
  });

  it("UX-38: the ES /invoices hero breakdown never shows en-US short dates ('Aug 25' / 'Tue')", () => {
    cy.clearCookies();
    cy.loginAs(PHONE);
    // A sent invoice due in 5 days always lands inside the 7-day forecast
    // window (compute-invoice-forecast: sent → expectedLandDate = dueDate),
    // so the hero breakdown (data-cy="forecast-breakdown") must render it.
    cy.apiCreateInvoice({
      customerId,
      amount: 123400,
      dueDate: new Date(Date.now() + 5 * 24 * 3600 * 1000)
        .toISOString()
        .slice(0, 10),
      status: "sent",
      jobName: JOB,
      lineItems: [
        { description: "Terraza", quantity: 1, unit: "job", price: 123400 },
      ],
    });

    cy.visit("/invoices?lang=es"); // ?lang wins the island langSignal seed
    cy.get('[data-cy="forecast-hero"]', { timeout: 10_000 }).should(
      "be.visible",
    );
    cy.get('[data-cy="forecast-breakdown"]', { timeout: 10_000 })
      .invoke("text")
      .should((text: string) => {
        // RED today: shortDay() is en-US in BOTH branches, so the breakdown
        // shows "Aug 25"-style or "Tue"-style tokens on the Spanish page.
        // (Case-sensitive on purpose: the ES forms are lowercase — "25 ago",
        // "mar" — so capitalized en-US tokens are unambiguous.)
        expect(text, "no en-US month-day short date").not.to.match(
          /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/,
        );
        expect(text, "no en-US weekday abbreviation").not.to.match(
          /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/,
        );
        // Desired: the ES short form — day-first "25 ago" (the dicts'
        // invoicesPage.month.* table) or an ES weekday abbreviation.
        expect(text, "shows a Spanish short date").to.match(
          /(\d{1,2}\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\b|\b(lun|mar|mié|mie|jue|vie|sáb|sab|dom)\b)/,
        );
      });
  });
});

export {};
