/**
 * REQ-264 (demo M15), Raphael: "fix every issue the demo found".
 *
 * M15: the English version of a Spanish quote was not translated — the
 * send-card preview said "translation missing" and /q?lang=en stayed
 * Spanish. Line items had ONE description (no per-language variant), and a
 * chat-created quote had no job-details description, so the only translator
 * (the contractor's preview) had nothing to do.
 *
 * These pin the shared, pure half of the fix: which parts of a quote still
 * need a translation per language, and how a document reads a line item in
 * its own language.
 */
import {
  descriptionTranslationsStale,
  lineItemDescription,
  localizeLineItems,
  missingQuoteTranslations,
  previewTranslationMissing,
  QUOTE_LANGS,
  quoteDescription,
  reconcileLineItemTranslations,
} from "../../shared/quote-flow/quote-translations";

const spanishChatQuote = {
  // free-chat create_quote: no description, Spanish line items only
  lineItems: [
    { description: "Pintar el baño", quantity: 1, unit: "ea", price: 40_000 },
    {
      description: "Limpieza y retiro de desechos",
      quantity: 1,
      unit: "ea",
      price: 5_000,
    },
  ],
};

describe("REQ-264 (M15) quote translations — what still needs translating", () => {
  it("REQ-264 the document languages are English and Spanish", () => {
    expect([...QUOTE_LANGS]).toEqual(["en", "es"]);
  });

  it("REQ-264 a chat quote with no description still needs its line items in both languages", () => {
    const missing = missingQuoteTranslations(spanishChatQuote);
    expect(missing).toEqual([
      { lang: "en", descriptionLines: [], lineIndexes: [0, 1] },
      { lang: "es", descriptionLines: [], lineIndexes: [0, 1] },
    ]);
  });

  it("REQ-264 the description is split into its non-empty bullet lines", () => {
    const missing = missingQuoteTranslations(
      {
        description: "Preparar paredes\n\n  Pintar dos manos  ",
        descriptionByLang: { es: "Preparar paredes\nPintar dos manos" },
        lineItems: [],
      },
      ["en", "es"],
    );
    expect(missing).toEqual([
      {
        lang: "en",
        descriptionLines: ["Preparar paredes", "Pintar dos manos"],
        lineIndexes: [],
      },
    ]);
  });

  it("REQ-264 a fully translated quote needs nothing", () => {
    expect(
      missingQuoteTranslations({
        description: "Pintar",
        descriptionByLang: { en: "Paint", es: "Pintar" },
        lineItems: [{
          description: "Pintar",
          descriptionByLang: { en: "Paint", es: "Pintar" },
        }],
      }),
    ).toEqual([]);
  });

  it("REQ-264 a blank cached translation counts as missing", () => {
    const missing = missingQuoteTranslations(
      {
        lineItems: [{ description: "Pintar", descriptionByLang: { en: "  " } }],
      },
      ["en"],
    );
    expect(missing).toEqual([
      { lang: "en", descriptionLines: [], lineIndexes: [0] },
    ]);
  });

  it("REQ-264 blank line items are never sent to the translator", () => {
    const missing = missingQuoteTranslations(
      { lineItems: [{ description: "  " }, { description: "Pintar" }] },
      ["en"],
    );
    expect(missing).toEqual([
      { lang: "en", descriptionLines: [], lineIndexes: [1] },
    ]);
  });
});

describe("REQ-264 (M15) documents read line items in their own language", () => {
  const translated = {
    description: "Pintar el baño",
    descriptionByLang: { en: "Paint the bathroom", es: "Pintar el baño" },
    lineItems: [{
      description: "Limpieza y retiro de desechos",
      descriptionByLang: { en: "Cleanup and debris removal" },
      quantity: 1,
      unit: "ea",
      price: 5_000,
    }],
  };

  it("REQ-264 a line item renders its translation, else its base text", () => {
    expect(lineItemDescription(translated.lineItems[0], "en")).toBe(
      "Cleanup and debris removal",
    );
    expect(lineItemDescription(translated.lineItems[0], "es")).toBe(
      "Limpieza y retiro de desechos",
    );
  });

  it("REQ-264 localizeLineItems keeps price/qty/unit and swaps the text", () => {
    expect(localizeLineItems(translated.lineItems, "en")).toEqual([
      {
        description: "Cleanup and debris removal",
        descriptionByLang: { en: "Cleanup and debris removal" },
        quantity: 1,
        unit: "ea",
        price: 5_000,
      },
    ]);
    expect(localizeLineItems(undefined, "en")).toEqual([]);
  });

  it("REQ-264 the description falls back to the base text when untranslated", () => {
    expect(quoteDescription(translated, "en")).toBe("Paint the bathroom");
    expect(quoteDescription({ description: "Pintar" }, "en")).toBe("Pintar");
    expect(quoteDescription({}, "en")).toBeUndefined();
  });

  it("REQ-264 the preview flags a language only while something in it is untranslated", () => {
    // M15 pair 6: chat quote, no description — the old check (description
    // only) could never clear; the line items are what is missing.
    expect(previewTranslationMissing(spanishChatQuote, "en")).toBe(true);
    expect(previewTranslationMissing(translated, "es")).toBe(true);
    expect(
      previewTranslationMissing({
        ...translated,
        lineItems: [{
          ...translated.lineItems[0],
          descriptionByLang: { en: "Cleanup", es: "Limpieza" },
        }],
      }, "es"),
    ).toBe(false);
    expect(previewTranslationMissing(undefined, "en")).toBe(false);
  });
});

describe("REQ-264 (M15) an edited text drops its stale translations", () => {
  const stored = [
    { description: "Pintar", descriptionByLang: { en: "Paint" } },
    { description: "Limpieza", descriptionByLang: { en: "Cleanup" } },
  ];

  it("REQ-264 a changed line that round-trips the old map loses it", () => {
    const out = reconcileLineItemTranslations(stored, [
      stored[0],
      { ...stored[1], description: "Limpieza y retiro" },
    ]);
    expect(out[0].descriptionByLang).toEqual({ en: "Paint" });
    expect(out[1]).toEqual({ description: "Limpieza y retiro" });
  });

  it("REQ-264 an unchanged line keeps its map even when the edit omits it", () => {
    const out = reconcileLineItemTranslations(stored, [
      { description: "Pintar" },
    ]);
    expect(out).toEqual([{
      description: "Pintar",
      descriptionByLang: { en: "Paint" },
    }]);
  });

  it("REQ-264 a new map written with a changed line is kept", () => {
    const out = reconcileLineItemTranslations(stored, [
      { description: "Pintar todo", descriptionByLang: { en: "Paint it all" } },
    ]);
    expect(out[0].descriptionByLang).toEqual({ en: "Paint it all" });
  });

  it("REQ-264 a changed description without a new map is stale", () => {
    const prev = { description: "Pintar", descriptionByLang: { en: "Paint" } };
    expect(descriptionTranslationsStale(prev, { description: "Pintar más" }))
      .toBe(true);
    expect(descriptionTranslationsStale(prev, { description: "Pintar" }))
      .toBe(false);
    expect(
      descriptionTranslationsStale(prev, {
        description: "Pintar más",
        descriptionByLang: { en: "Paint more" },
      }),
    ).toBe(false);
    expect(descriptionTranslationsStale(prev, {})).toBe(false);
  });
});
