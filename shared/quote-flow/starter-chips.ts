/**
 * Starter-chip routing (P-20): each of the four chat starter chips maps to a
 * DISTINCT intent and a distinct, intent-appropriate first reply — the
 * "Trabajo terminado, necesito facturar" chip talks about invoicing, never a
 * cotización.
 *
 * Chip keys ground out of the lang dicts (asstChat.prompt.*). Frontend wiring:
 * AsstChat.tsx:4296-4325 — knownPrice→startKnownPriceFlow, helpPrice→
 * startHelpMePriceFlow, quickQuote→startQuickQuoteFlow (today a dup of
 * knownPrice), invoiceDone→startInvoiceFlow.
 */

export type ChipKey = "knownPrice" | "helpPrice" | "quickQuote" | "invoiceDone";

const INTENTS: Record<ChipKey, string> = {
  knownPrice: "draft-known-price-quote",
  helpPrice: "help-me-price",
  quickQuote: "quick-quote",
  invoiceDone: "create-invoice",
};

const REPLIES: Record<"en" | "es", Record<ChipKey, string>> = {
  en: {
    // The EN knownPrice/helpPrice replies keep the "tell me the job details"
    // phrase — the back-button and help-me-price e2e contracts pin the
    // details bubble to /tell me the job( details)?/i.
    knownPrice:
      "Great — you know your price. Tell me the job details and the amount, and I'll write it up.",
    helpPrice:
      "Let's price it together — tell me the job details and I'll suggest a fair number.",
    quickQuote:
      "Quick quote coming up. Give me the job in one line and I'll draft it fast.",
    invoiceDone:
      "Job done — let's get you paid. Which job is this invoice for?",
  },
  es: {
    knownPrice:
      "Perfecto — ya sabes tu precio. Dime el trabajo y el monto, y lo redacto.",
    helpPrice:
      "Vamos a ponerle precio juntos. Descríbeme el trabajo y te sugiero un número justo.",
    quickQuote:
      "Va esa cotización rápida. Dime el trabajo en una línea y la armo al momento.",
    invoiceDone:
      "Trabajo terminado — vamos a facturar para que te paguen. ¿De qué trabajo es la factura?",
  },
};

/** A distinct routing intent per chip — the invoice chip is about invoicing. */
export function chipIntent(key: ChipKey): string {
  return INTENTS[key];
}

/** The chip's first assistant reply — distinct per chip and per language. */
export function chipReply(key: ChipKey, lang: "en" | "es"): string {
  return REPLIES[lang][key];
}
