/**
 * REQ-710 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5, issue M4: the English version of a quote or
 * invoice typed in Spanish kept the Spanish title, lines and e-mail subject.
 *
 *   - pair 6 (app in English) typed the quote in Spanish; the base language
 *     came from the APP language, so the typed Spanish was stored verbatim
 *     as the "English" copy ("Carmen Núñez's Reparación de puerta Agreement").
 *   - pair 9's English invoice kept the line "Retiro de refrigerador y
 *     lavadora" and the payment instructions "Zelle: … · Efectivo".
 *   - pair 7's English job details read "Install kitchen backsplash 30 pies
 *     cuadrados subway tile".
 *
 * These pin the shared, pure half of the fix (lazy-required, so a missing
 * export reds each test for its own reason):
 *   shared/quote-flow/quote-translations.ts  quoteTextLang, quoteLangStale,
 *                                            previewTranslationMissing
 *   shared/quote-flow/message-language.ts    lineLangMismatch
 *   shared/documents/invoice-form.ts         localizePaymentInstructions
 *   shared/documents/invoice-lang.ts         invoiceLineItemsByLang
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const translations = () =>
  require("../../shared/quote-flow/quote-translations");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const language = () => require("../../shared/quote-flow/message-language");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const invoiceForm = () => require("../../shared/documents/invoice-form");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const invoiceLang = () => require("../../shared/documents/invoice-lang");

/** Pair 6's quote as the chat drafted it — typed in Spanish, app in English. */
const pair6 = {
  summary:
    "Reparación de puerta de cocina y cambio de llave del fregadero — Carmen Núñez",
  jobName: "Reparación de puerta",
  lineItems: [
    { description: "Reparación de puerta de cocina", price: 17_500 },
    { description: "Cambio de llave del fregadero", price: 17_500 },
  ],
};

/** The same quote after the old lock: the app language stamped as its base
 *  and the typed Spanish copied verbatim into every English slot. */
const pair6Locked = {
  ...pair6,
  lang: "en",
  jobNameByLang: { en: "Reparación de puerta", es: "Reparación de puerta" },
  summaryByLang: { en: pair6.summary, es: pair6.summary },
  lineItems: pair6.lineItems.map((li) => ({
    ...li,
    descriptionByLang: { en: li.description, es: li.description },
  })),
};

describe("REQ-710 (cycle 5, M4) a quote's base language is the language its text was typed in", () => {
  it("REQ-710 pair 6's quote reads Spanish", () => {
    expect(translations().quoteTextLang(pair6)).toBe("es");
  });

  it("REQ-710 a line-initial capital starts the line, it is not a name — 'Reparación de puerta' alone reads Spanish", () => {
    expect(translations().quoteTextLang({ jobName: "Reparación de puerta" }))
      .toBe("es");
  });

  it("REQ-710 an English quote reads English, a Spanish customer name in it included", () => {
    const { quoteTextLang } = translations();
    expect(quoteTextLang({
      summary: "Kitchen backsplash for the Hendersons",
      lineItems: [
        { description: "Install the backsplash" },
        { description: "Grout and seal" },
      ],
    })).toBe("en");
    expect(quoteTextLang({
      summary: "Deck repair for María José Peña",
      lineItems: [{ description: "Replace the deck boards" }],
    })).toBe("en");
  });

  it("REQ-710 a Spanish surname's particles are part of the NAME — an English quote for José de la Cruz never reads Spanish", () => {
    const { quoteTextLang } = translations();
    // "de la" sits between two capitalised words: a name, not Spanish prose.
    expect(quoteTextLang({
      summary: "Deck repair — José de la Cruz",
      lineItems: [
        { description: "Replace deck boards" },
        { description: "Stain deck" },
      ],
    })).toBeUndefined();
    expect(quoteTextLang({
      summary: "Fence install for María de los Santos",
      lineItems: [{ description: "Cedar fence for the backyard" }],
    })).toBe("en");
    // the same customer on a Spanish quote still reads Spanish
    expect(quoteTextLang({
      summary: "Reparación de la terraza — José de la Cruz",
      lineItems: [{ description: "Cambio de tablas" }],
    })).toBe("es");
  });

  it("REQ-710 text too short to tell is undefined — the caller falls back to the stored, then the app language", () => {
    const { quoteTextLang } = translations();
    expect(quoteTextLang({
      jobName: "Bathroom remodel",
      lineItems: [{ description: "Demo and haul-off" }],
    })).toBeUndefined();
    expect(quoteTextLang(undefined)).toBeUndefined();
  });

  it("REQ-710 a stored base that disagrees with the text is stale (the quote locked as English)", () => {
    const { quoteLangStale } = translations();
    expect(quoteLangStale(pair6Locked)).toBe(true);
    expect(quoteLangStale({ ...pair6Locked, lang: "es" })).toBe(false);
    expect(quoteLangStale({ ...pair6Locked, lang: undefined })).toBe(false);
    expect(quoteLangStale({
      lang: "en",
      jobName: "Bathroom remodel",
      lineItems: [{ description: "Demo and haul-off" }],
    })).toBe(false);
  });

  it("REQ-710 the preview asks the server for English when the English slots only hold the typed Spanish", () => {
    const { previewTranslationMissing } = translations();
    expect(previewTranslationMissing(pair6Locked, "en")).toBe(true);
    // Repaired: Spanish is the base and English is a real translation.
    const repaired = {
      ...pair6,
      lang: "es",
      jobNameByLang: { es: "Reparación de puerta", en: "Door Repair" },
      lineItems: [
        {
          description: "Reparación de puerta de cocina",
          descriptionByLang: {
            es: "Reparación de puerta de cocina",
            en: "Kitchen door repair",
          },
        },
        {
          description: "Cambio de llave del fregadero",
          descriptionByLang: {
            es: "Cambio de llave del fregadero",
            en: "Kitchen sink faucet replacement",
          },
        },
      ],
    };
    expect(previewTranslationMissing(repaired, "en")).toBe(false);
  });
});

describe("REQ-710 (cycle 5, M4, pair 7) a generated line written in the wrong language for its slot", () => {
  it("REQ-710 Spanish units in an English line are caught; the English units are not", () => {
    const { lineLangMismatch } = language();
    expect(
      lineLangMismatch(
        "Install kitchen backsplash 30 pies cuadrados subway tile",
        "en",
      ),
    ).toBe(true);
    expect(
      lineLangMismatch(
        "Install kitchen backsplash, 30 sq ft subway tile",
        "en",
      ),
    ).toBe(false);
  });

  it("REQ-710 English units left in a Spanish line are caught (REQ-448: never sq ft in Spanish)", () => {
    const { lineLangMismatch } = language();
    expect(
      lineLangMismatch("Instalar salpicadero de cocina de 30 sq ft", "es"),
    ).toBe(true);
    expect(
      lineLangMismatch(
        "Instalar salpicadero de cocina de 30 pies cuadrados",
        "es",
      ),
    ).toBe(false);
  });

  it("REQ-710 a line that reads as the other language is caught in either slot", () => {
    const { lineLangMismatch } = language();
    expect(lineLangMismatch("Instalar el salpicadero de la cocina", "en"))
      .toBe(true);
    expect(lineLangMismatch("Install the backsplash and the subway tile", "es"))
      .toBe(true);
  });

  it("REQ-710 a name's particles never mark an English line as Spanish ('Casa de la Rosa')", () => {
    const { lineLangMismatch } = language();
    expect(lineLangMismatch("Paint the Casa de la Rosa sign", "en")).toBe(
      false,
    );
    expect(lineLangMismatch("Pintar el letrero de la entrada", "en")).toBe(
      true,
    );
  });

  it("REQ-710 ordinary lines in their own language pass", () => {
    const { lineLangMismatch } = language();
    expect(lineLangMismatch("Gut master bath 8x10", "en")).toBe(false);
    expect(lineLangMismatch("Job located on Shoal Creek", "en")).toBe(false);
    expect(lineLangMismatch("Desmantelar baño principal 8x10", "es")).toBe(
      false,
    );
    expect(lineLangMismatch("", "en")).toBe(false);
  });
});

describe("REQ-710 (cycle 5, M4, pair 9) payment instructions read in the document's language", () => {
  it("REQ-710 the Spanish line the invoice modal froze reads 'Cash' on the English invoice", () => {
    const { localizePaymentInstructions } = invoiceForm();
    expect(
      localizePaymentInstructions("Zelle: +1 (512) 555-0108 · Efectivo", "en"),
    ).toBe("Zelle: +1 (512) 555-0108 · Cash");
    expect(
      localizePaymentInstructions("Zelle: +1 (512) 555-0108 · Cash", "es"),
    ).toBe("Zelle: +1 (512) 555-0108 · Efectivo");
  });

  it("REQ-710 the line built from the methods in Spanish reads exactly as the one built in English", () => {
    const { localizePaymentInstructions, paymentInstructionsFromMethods } =
      invoiceForm();
    const methods = {
      check: { enabled: true, mailTo: "Rosa Diaz, 12 Oak St" },
      venmo: { enabled: true, handle: "@rosa" },
      zelle: { enabled: true, handle: "5125550108" },
      cashapp: { enabled: true, cashtag: "$rosa" },
      paypal: { enabled: true, handle: "rosa@example.com" },
      cash: { enabled: true },
      ach: { enabled: true, instructions: "pídeme los datos" },
      card: { enabled: true },
    };
    const es = paymentInstructionsFromMethods(methods, "es");
    const en = paymentInstructionsFromMethods(methods, "en");
    expect(es).toContain("Efectivo");
    expect(localizePaymentInstructions(es, "en")).toBe(en);
    expect(localizePaymentInstructions(en, "es")).toBe(es);
  });

  it("REQ-710 one method per line (Settings' own text) reads in the document's language too", () => {
    const { localizePaymentInstructions } = invoiceForm();
    expect(
      localizePaymentInstructions("Zelle: +1 (512) 555-0108\nEfectivo", "en"),
    ).toBe("Zelle: +1 (512) 555-0108\nCash");
    expect(
      localizePaymentInstructions(
        "Cheque a nombre de Rosa Díaz\nTarjeta",
        "en",
      ),
    ).toBe("Cheque a nombre de Rosa Díaz\nCard");
  });

  it("REQ-710 the contractor's own words are left as typed", () => {
    const { localizePaymentInstructions } = invoiceForm();
    expect(
      localizePaymentInstructions("Pago al terminar el trabajo", "en"),
    ).toBe("Pago al terminar el trabajo");
    expect(
      localizePaymentInstructions("Cash only, exact change please", "es"),
    ).toBe("Cash only, exact change please");
    expect(localizePaymentInstructions(undefined, "en")).toBe("");
  });
});

describe("REQ-710 (cycle 5, M4, pair 9) a standalone invoice's line items carry their translation onto /i", () => {
  it("REQ-710 a line's per-language text is projected while it still describes the line; an edited line shows as typed", () => {
    const { invoiceLineItemsByLang } = invoiceLang();
    const items = invoiceLineItemsByLang({ lang: "es" }, [
      {
        description: "Retiro de refrigerador y lavadora",
        descriptionByLang: {
          es: "Retiro de refrigerador y lavadora",
          en: "Removal of refrigerator and washing machine",
        },
        quantity: 1,
        price: 20_000,
      },
      {
        description: "Retiro de estufa",
        descriptionByLang: { es: "Retiro de secadora", en: "Dryer removal" },
        quantity: 1,
        price: 5_000,
      },
    ]);
    expect(items[0].descriptionByLang?.en).toBe(
      "Removal of refrigerator and washing machine",
    );
    expect(items[0].price).toBe(20_000);
    expect(items[1].description).toBe("Retiro de estufa");
    expect(items[1].descriptionByLang).toBeUndefined();
  });

  it("REQ-710 no base language recorded → no map is trusted", () => {
    const { invoiceLineItemsByLang } = invoiceLang();
    const items = invoiceLineItemsByLang({}, [{
      description: "Retiro de estufa",
      descriptionByLang: { es: "Retiro de estufa", en: "Stove removal" },
    }]);
    expect(items[0].descriptionByLang).toBeUndefined();
  });
});

describe("REQ-710 (cycle 5, M4) the assistant preview reads the language the server re-based the quote on", () => {
  it("REQ-710 the translate reply's `lang` replaces the preview's stale one — else lineItemDescription keeps the typed Spanish as the 'English' line", () => {
    const src = readFileSync(
      resolve(__dirname, "../../front-end/islands/AsstChat.tsx"),
      "utf8",
    );
    const at = src.indexOf("assistantClient.translateQuote(");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 1200)).toMatch(
      /lang:\s*res\.lang\s*\?\?\s*q\.lang/,
    );
  });
});
