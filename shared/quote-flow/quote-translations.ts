/**
 * REQ-264 (demo M15) — per-language text of a quote.
 *
 * A quote's customer-facing text lives in a base field plus a per-language
 * cache: `description` + `descriptionByLang`, and for each line item
 * `description` + `descriptionByLang`. The server fills the caches for every
 * document language (TranslateQuote, run on send and from the contractor's
 * preview); every reader goes through the helpers here so the web page, the
 * email and the preview pick the same text.
 */

export const QUOTE_LANGS = ["en", "es"] as const;
export type QuoteLang = typeof QUOTE_LANGS[number];

export interface TranslatableLineItem {
  description: string;
  descriptionByLang?: Record<string, string>;
}

export interface TranslatableQuote {
  /** REQ-333 (M24): the language the base text was typed in — stored by
   *  TranslateQuote. That language is never a translation. */
  lang?: string;
  description?: string;
  descriptionByLang?: Record<string, string>;
  lineItems?: TranslatableLineItem[];
}

/** What one language still needs translated. */
export interface MissingTranslation {
  lang: string;
  /** Non-empty bullet lines of the base description (empty when cached or
   *  there is no description). */
  descriptionLines: string[];
  /** Indexes of line items with text but no cached translation. */
  lineIndexes: number[];
}

function has(map: Record<string, string> | undefined, lang: string): boolean {
  return !!map?.[lang]?.trim();
}

export function descriptionLines(description: string | undefined): string[] {
  return (description ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Per language, the parts of the quote with text but no translation yet.
 *  Languages with nothing missing are omitted. REQ-333 (M24): the base
 *  language (`baseLang`, else the quote's stored `lang`) is never missing —
 *  its text is the typed text, not something to translate. */
export function missingQuoteTranslations(
  quote: TranslatableQuote | undefined | null,
  langs: readonly string[] = QUOTE_LANGS,
  baseLang?: string,
): MissingTranslation[] {
  if (!quote) return [];
  const base = baseLang ?? quote.lang;
  const out: MissingTranslation[] = [];
  for (const lang of langs) {
    if (lang === base) continue;
    const lines = has(quote.descriptionByLang, lang)
      ? []
      : descriptionLines(quote.description);
    const lineIndexes: number[] = [];
    (quote.lineItems ?? []).forEach((li, i) => {
      if ((li?.description ?? "").trim() && !has(li.descriptionByLang, lang)) {
        lineIndexes.push(i);
      }
    });
    if (lines.length || lineIndexes.length) {
      out.push({ lang, descriptionLines: lines, lineIndexes });
    }
  }
  return out;
}

/** The preview's UX-06 notice: something in this language is untranslated. */
export function previewTranslationMissing(
  quote: TranslatableQuote | undefined | null,
  lang: string,
): boolean {
  return missingQuoteTranslations(quote, [lang]).length > 0;
}

/** A line item's text in `lang`, else its base text. REQ-333 (M24): asked
 *  for the base language (`baseLang`) it is the typed text itself — a cache
 *  in that slot is never a translation (an older run may have paraphrased). */
export function lineItemDescription(
  li: TranslatableLineItem,
  lang: string,
  baseLang?: string,
): string {
  if (baseLang !== undefined && lang === baseLang) return li.description;
  return has(li.descriptionByLang, lang)
    ? li.descriptionByLang![lang]
    : li.description;
}

/** The line items with `description` swapped for the `lang` text. */
export function localizeLineItems<T extends TranslatableLineItem>(
  items: T[] | undefined | null,
  lang: string,
  baseLang?: string,
): T[] {
  return (items ?? []).map((li) => ({
    ...li,
    description: lineItemDescription(li, lang, baseLang),
  }));
}

function sameMap(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  return ka.length === kb.length && ka.every((k) => a![k] === b?.[k]);
}

/**
 * A cached translation describes the text it was made from. Given the stored
 * line items and the ones an edit writes, returns the items to store:
 *  - text unchanged at that position → keeps the stored translations when the
 *    edit carried none (an editor that does not round-trip the map);
 *  - text changed and the edit round-tripped the stored map (or sent none) →
 *    the stale translations are dropped, so the next send re-translates;
 *  - the edit wrote a NEW map with the item → kept as written.
 */
export function reconcileLineItemTranslations<T extends TranslatableLineItem>(
  prev: readonly TranslatableLineItem[] | undefined | null,
  next: readonly T[],
): T[] {
  return next.map((li, i) => {
    const old = prev?.[i];
    const sameText = !!old && old.description === li.description;
    if (sameText) {
      return li.descriptionByLang || !old.descriptionByLang
        ? li
        : { ...li, descriptionByLang: old.descriptionByLang };
    }
    const freshMap = !!li.descriptionByLang &&
      (!old || !sameMap(old.descriptionByLang, li.descriptionByLang));
    if (freshMap || !li.descriptionByLang) return li;
    const { descriptionByLang: _stale, ...rest } = li;
    return rest as T;
  });
}

/** True when an edit changes the description without writing a new
 *  translation map with it — the stored translations are then stale. */
export function descriptionTranslationsStale(
  prev: TranslatableQuote,
  patch: { description?: string; descriptionByLang?: Record<string, string> },
): boolean {
  return patch.description !== undefined &&
    patch.description !== prev.description &&
    patch.descriptionByLang === undefined;
}

/** The job-details description in `lang`, else the base description.
 *  REQ-333 (M24): in the base language (`baseLang`, else the quote's stored
 *  `lang`) it is the typed description itself. */
export function quoteDescription(
  quote: TranslatableQuote,
  lang: string,
  baseLang?: string,
): string | undefined {
  const base = baseLang ?? quote.lang;
  if (base !== undefined && lang === base) return quote.description;
  return has(quote.descriptionByLang, lang)
    ? quote.descriptionByLang![lang]
    : quote.description;
}
