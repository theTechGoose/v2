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
  const baseLines = descriptionLines(quote.description);
  for (const lang of langs) {
    if (lang === base) continue;
    // REQ-441 (cycle 3, M23): a cached copy with a different line count than
    // the base description is stale (a line was added or removed after it
    // was made) — re-translate it, never keep the short copy.
    const cached = quote.descriptionByLang?.[lang];
    const fresh = has(quote.descriptionByLang, lang) &&
      descriptionLines(cached).length === baseLines.length;
    const lines = fresh ? [] : baseLines;
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

/**
 * REQ-441 (demo-loop cycle 3, M23) — the job details of an option confirmed
 * in "help me price it", per language, for the quote startQuoteFromRaw
 * creates. The app language is the live text (`raw`, with any line the
 * contractor added or reworded). Another language reuses the option's
 * pre-generated bullets only when the live lines are exactly the app
 * language's pre-generated ones; otherwise it is `stale` — left out of the
 * map, so the caller translates the live lines (or TranslateQuote fills it).
 */
export function confirmedDescriptionByLang(
  byLang: Record<string, { bullets: readonly string[] }>,
  appLang: string,
  raw: string,
): { descriptionByLang: Record<string, string>; stale: string[] } {
  const live = descriptionLines(raw);
  const orig = (byLang[appLang]?.bullets ?? []).map((b) => b.trim())
    .filter(Boolean);
  const unedited = orig.length > 0 && live.length === orig.length &&
    live.every((t, i) => t === orig[i]);
  const descriptionByLang: Record<string, string> = { [appLang]: raw.trim() };
  const stale: string[] = [];
  for (const [l, v] of Object.entries(byLang)) {
    if (l === appLang) continue;
    const pre = (v?.bullets ?? []).map((b) => b.trim()).filter(Boolean);
    if (unedited && pre.length === live.length) {
      descriptionByLang[l] = pre.join("\n");
    } else stale.push(l);
  }
  return { descriptionByLang, stale };
}

/**
 * REQ-400 (demo-loop cycle 2, M5) — a quote's heading text: the job name
 * (agreement title, "for {job}" recital, e-mail subject, SMS, PDF, invoice)
 * and the summary, each with its per-language cache.
 */
export interface TranslatableHeading {
  lang?: string;
  jobName?: string;
  jobNameByLang?: Record<string, string>;
  summary?: string;
  summaryByLang?: Record<string, string>;
}

/**
 * REQ-591 (demo-loop cycle 4, M32) — a quote's summary in `lang`: the typed
 * summary when `lang` is the quote's own language, else `summaryByLang[lang]`,
 * else the job name in `lang`, else the typed summary. The email hero read
 * the raw summary, so the English email of a Spanish quote had an English
 * subject ("Faucet Repair") under a Spanish heading.
 */
export function quoteSummary(
  q: TranslatableHeading | undefined | null,
  lang: string,
): string | undefined {
  if (!q) return undefined;
  const typed = q.summary?.trim() || undefined;
  if (q.lang && q.lang === lang && typed) return typed;
  return q.summaryByLang?.[lang]?.trim() || q.jobNameByLang?.[lang]?.trim() ||
    typed;
}

/** What one language still needs of the heading. */
export interface MissingHeading {
  lang: string;
  /** The base job name, when this language has no cached one. */
  jobName?: string;
  /** The base summary, when this language has no cached one. */
  summary?: string;
}

/**
 * REQ-400 (M5): per language, the job name and summary with text but no
 * translation yet — "Maria Lopez's Reparación de puerta Agreement" was a
 * Spanish name nobody ever translated. Mirrors missingQuoteTranslations: the
 * base language (`baseLang`, else the quote's stored `lang`) is never
 * missing; ask with `""` to see the base slots themselves.
 */
export function missingHeadingTranslations(
  quote: TranslatableHeading | undefined | null,
  langs: readonly string[] = QUOTE_LANGS,
  baseLang?: string,
): MissingHeading[] {
  if (!quote) return [];
  const base = baseLang ?? quote.lang;
  const jobName = quote.jobName?.trim();
  const summary = quote.summary?.trim();
  const out: MissingHeading[] = [];
  for (const lang of langs) {
    if (lang === base) continue;
    const m: MissingHeading = { lang };
    if (jobName && !has(quote.jobNameByLang, lang)) m.jobName = jobName;
    if (summary && !has(quote.summaryByLang, lang)) m.summary = summary;
    if (m.jobName || m.summary) out.push(m);
  }
  return out;
}

/**
 * REQ-400 (M5): like descriptionTranslationsStale, for the heading — an edit
 * that changes the job name (or the summary) without writing a new map with
 * it leaves the cached translations describing the OLD text.
 */
export function headingTranslationsStale(
  prev: TranslatableHeading,
  patch: {
    jobName?: string;
    jobNameByLang?: Record<string, string>;
    summary?: string;
    summaryByLang?: Record<string, string>;
  },
): { jobName: boolean; summary: boolean } {
  return {
    jobName: patch.jobName !== undefined && patch.jobName !== prev.jobName &&
      patch.jobNameByLang === undefined,
    summary: patch.summary !== undefined && patch.summary !== prev.summary &&
      patch.summaryByLang === undefined,
  };
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
