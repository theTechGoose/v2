/// <reference types="cypress" />

/**
 * UX-38 + UX-39 + UX-40: the Spanish customer-facing /q agreement page and
 * the ES /invoices hero.
 *
 * (Ported from the old /c page after the Quote+Contract merge: /q/:id now
 * renders the FULL Quote + Agreement document, and accepting there is the
 * one signature ceremony.)
 *
 *   UX-38 "English-formatted dates on the Spanish agreement." —
 *         "vigente 18 de agosto de 2026", "Fecha: …", the signed badge
 *         "FIRMADO …", the signature timestamp; and the ES /invoices hero
 *         short date ("25 ago", never "Aug 25").
 *   UX-39 "The post-sign confirmation promises an email to a customer who
 *         has none." — the copy must name the channel that exists
 *         (quoteDoc.signedNoteSms: "Te enviaremos la confirmación por
 *         mensaje de texto a tu teléfono.").
 *   UX-40 "the browser-tab title is localized" on the Spanish agreement.
 *
 * Selector grounding (read post-merge):
 *   - /q route: front-end/routes/q/[id].tsx — lang from the pm_lang cookie;
 *     tab title via tFor(lang, "quoteDoc.docTitle") (ES: "Cotización +
 *     Acuerdo · Paperwork Monster").
 *   - /q dates: front-end/components/quote-doc.tsx renders every date via
 *     the lang-aware doc-parts fmtDate — the "vigente" between-parties line,
 *     the "Fecha:" contractor-signature line, the "Firmado {date}" pill, and
 *     the customer-signature timestamp.
 *   - Signature pad flow: front-end/islands/PublicSignQuote.tsx — the form
 *     is `form.ctr__sign-form`, submit label publicSign.submitEnabled
 *     ("Firmar el acuerdo →"); it POSTs /api/quotes/:id/accept and reloads
 *     ~900ms after success. The SIGNED page renders "Firmado y vinculante"
 *     (quoteDoc.signedBinding) + the channel note (signedNote /
 *     signedNoteSms). "Ambas firmas capturadas." (quoteDoc.bothCaptured)
 *     renders ONLY in the signed state — used as the post-reload gate.
 *   - /invoices hero: front-end/islands/InvoicesPage.tsx
 *     (data-cy="forecast-hero" / data-cy="forecast-breakdown"); the ES
 *     short-month table is lang/es.json invoicesPage.month.* (ene…dic).
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

describe("UX-38/39/40 — Spanish /q agreement page + ES /invoices hero", () => {
  let customerId: string;
  let quoteId: string;

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
      // The quote is deliberately NOT accepted here — the pad ceremony in
      // the UX-39 test below is this deal's one legitimate signing.
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
        terms: [
          {
            stepId: "payment_terms",
            label: "Payment terms",
            value: "50 / 50",
          },
        ],
      }).then((qId: string) => {
        quoteId = qId;
      });
    });
  });

  it("UX-38: the ES /q 'vigente' line and 'Fecha:' block use '18 de agosto de 2026', never en-US", () => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.visit(`/q/${quoteId}`);
    cy.contains(new RegExp(JOB, "i"), { timeout: 10_000 }).should("be.visible");

    // The between-parties row: "… · vigente <date>" (quote-doc.tsx).
    cy.contains("vigente")
      .invoke("text")
      .should((text: string) => {
        expect(text, "vigente line uses the ES long form").to.match(ES_LONG);
        expect(text, "vigente line has no en-US date").not.to.match(EN_LONG);
      });

    // The contractor-signature date line: "Fecha: <date>" (quote-doc.tsx).
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
        expect(text, "no en-US long dates on the ES /q page").not.to.match(
          EN_LONG,
        );
      });
  });

  it("UX-39: signing without an email on file — the confirmation must not promise 'correo'/'spam'", () => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.visit(`/q/${quoteId}`);

    // Sign via the real UI pad flow: type the legal name, then submit. The
    // typed name alone is enough — the island renders a cursive PNG from it.
    // Accepting the quote IS the signature ceremony.
    cy.get("form.ctr__sign-form", { timeout: 10_000 })
      .find("input")
      .first()
      .type(CUSTOMER_NAME);
    cy.contains("button", /firmar el contrato/i).click();

    // The island reloads ~900ms after success; "Ambas firmas capturadas."
    // renders only on the signed page (quoteDoc.bothCaptured) — a stable
    // post-reload gate.
    cy.contains(/ambas firmas capturadas/i, { timeout: 15_000 }).should(
      "be.visible",
    );

    // The signed confirmation strip (quote-doc.tsx signed branch). UX-39:
    // for a customer with NO email the note must name the real channel
    // (quoteDoc.signedNoteSms — text message), never "correo"/"spam".
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
    // Guard: ensure accepted even if the UI flow above was flaky. A second
    // accept on an already-accepted quote 409s (already_accepted) — either
    // way the quote is accepted afterwards, which is all this test needs.
    cy.apiAcceptQuote(quoteId, {
      name: CUSTOMER_NAME,
      signature: CUSTOMER_NAME,
    });
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.visit(`/q/${quoteId}`);
    cy.contains(new RegExp(JOB, "i"), { timeout: 10_000 }).should("be.visible");

    cy.get("body")
      .invoke("text")
      .should((text: string) => {
        // The status pill (quoteDoc.signed): "Firmado {date}" must carry the
        // ES long form.
        expect(text, "FIRMADO badge date is Spanish").to.match(
          new RegExp(String.raw`Firmado\s+\d{1,2} de \p{L}+ de \d{4}`, "iu"),
        );
        // No en-US long date anywhere — also covers the signature-card
        // timestamp.
        expect(text, "no en-US long dates on the signed ES page").not.to.match(
          EN_LONG,
        );
      });
  });

  it("UX-40: the ES /q browser-tab title is localized", () => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "es");
    cy.visit(`/q/${quoteId}`);
    // routes/q/[id].tsx localizes via tFor(lang, "quoteDoc.docTitle") —
    // ES: "Cotización + Acuerdo · Paperwork Monster".
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
