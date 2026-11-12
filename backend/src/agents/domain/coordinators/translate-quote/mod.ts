import { Injectable } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import {
  type MissingHeading,
  missingHeadingTranslations,
  missingQuoteTranslations,
  type MissingTranslation,
  QUOTE_LANGS,
  type QuoteLang,
} from "#quote-flow/quote-translations.ts";
import { jobNameCase, translatedJobNameCase } from "#quote-flow/job-name.ts";

export interface TranslateQuoteInput {
  userId: string;
  quoteId: string;
  /** Languages to fill; defaults to every document language (en, es). */
  langs?: readonly ("en" | "es")[];
  /** REQ-333 (M24): the language the quote's text was written in. Defaults
   *  to the quote's stored `lang`, else the contractor's app language, else
   *  English. That language is never sent to the model. */
  baseLang?: QuoteLang;
}

/**
 * REQ-264 (demo M15) — TranslateQuote fills a quote's per-language caches on
 * the SERVER: `descriptionByLang[lang]` and every `lineItems[i]
 * .descriptionByLang[lang]`, for each document language that is missing one.
 *
 * Before this, translation was lazy and lived only in the contractor's
 * preview (description only, and only when that language was previewed), so
 * a Spanish chat quote opened at /q?lang=en stayed Spanish. It runs on send
 * (SendQuote) and from the preview (POST /quotes/:id/translate).
 *
 * One TranslateBullets call per language carries the description lines and
 * the line-item texts together. A failed language is NOT cached (the
 * originals would be stored as a "translation"), so the next run retries.
 * Idempotent: languages already filled are never re-asked.
 *
 * REQ-333 (demo-loop cycle 1, M24) — the quote's OWN language is not a
 * translation. It used to be "missing" like any other, so an English
 * contractor's typed lines went through the model with to:'en' and came
 * back paraphrased ("Demo and haul-off" → "Demolition and removal"), and
 * every reader preferred that cache. Now the base language's cache is the
 * typed text verbatim, written without a model call, and the base language
 * is stored on the quote (`lang`) so readers can tell.
 *
 * REQ-400 (demo-loop cycle 2, M5) — the job name and the summary are
 * translated too. Every reader (the agreement's title and "for {job}"
 * recital, the e-mail subject, the SMS, the PDF, the invoice) prefers
 * `jobNameByLang[lang]` / `summaryByLang[lang]`, and only the picker ever
 * wrote them — so a chat quote, or an option generated in one language,
 * titled the other-language document in the base language ("Maria Lopez's
 * Reparación de puerta Agreement"). They ride the same batch as the lines:
 * the base language verbatim, the other through TranslateBullets, the name
 * cased for its language.
 */
@Injectable()
export class TranslateQuote {
  constructor(
    private quotes: QuoteStore,
    private translator: TranslateBullets,
    private users?: UserStore,
  ) {}

  async run(input: TranslateQuoteInput): Promise<Quote> {
    const quote = await this.quotes.getOwned(input.quoteId, input.userId);
    const base = await this.baseLang(quote, input);
    const langs = input.langs ?? QUOTE_LANGS;
    const missing = batches(
      missingQuoteTranslations(quote, langs, base),
      missingHeadingTranslations(quote, langs, base),
    );
    // The base slots still empty (a line added since the last run): `""` as
    // the base so the stored `lang` does not hide them from this check.
    const baseMissing = langs.includes(base)
      ? batches(
        missingQuoteTranslations(quote, [base], ""),
        missingHeadingTranslations(quote, [base], ""),
      )
      : [];
    if (missing.length === 0 && baseMissing.length === 0 && quote.lang) {
      return quote;
    }

    const textsOf = (m: Batch) => [
      ...m.descriptionLines,
      ...m.lineIndexes.map((i) => quote.lineItems[i].description.trim()),
      // REQ-400 (M5): the heading rides the same call.
      ...(m.jobName ? [m.jobName] : []),
      ...(m.summary ? [m.summary] : []),
    ];
    const results = await Promise.all(missing.map(async (m) => {
      const texts = textsOf(m);
      const res = await this.translator.run({
        userId: input.userId,
        texts,
        from: base,
        to: m.lang as "en" | "es",
      });
      return { m, res, texts };
    }));
    // REQ-333: the base language is the typed text itself — no model call.
    for (const m of baseMissing) {
      const texts = textsOf(m);
      results.push({ m, res: { texts, translated: true }, texts });
    }

    // Re-read so a concurrent edit (another field) isn't clobbered; merge
    // only into the slots this run translated, and only if their base text
    // is unchanged.
    const fresh = await this.quotes.getOwned(input.quoteId, input.userId);
    let descriptionByLang = fresh.descriptionByLang;
    let jobNameByLang = fresh.jobNameByLang;
    let summaryByLang = fresh.summaryByLang;
    const lineItems = (fresh.lineItems ?? []).map((li) => ({ ...li }));
    let changed = false;

    for (const { m, res, texts } of results) {
      if (!res.translated || res.texts.length !== texts.length) continue;
      const nDesc = m.descriptionLines.length;
      if (nDesc > 0 && fresh.description === quote.description) {
        descriptionByLang = {
          ...(descriptionByLang ?? {}),
          [m.lang]: res.texts.slice(0, nDesc).join("\n"),
        };
        changed = true;
      }
      m.lineIndexes.forEach((idx, k) => {
        const li = lineItems[idx];
        if (!li || li.description !== quote.lineItems[idx].description) return;
        li.descriptionByLang = {
          ...(li.descriptionByLang ?? {}),
          [m.lang]: res.texts[nDesc + k],
        };
        changed = true;
      });
      // REQ-400 (M5): the heading, unless it was renamed meanwhile. The base
      // name keeps its words (cased for its language, REQ-276); a translated
      // one is cased like a name in that language ("Door Repair").
      let k = nDesc + m.lineIndexes.length;
      const lang = m.lang as QuoteLang;
      if (m.jobName) {
        const text = res.texts[k++];
        if (fresh.jobName === quote.jobName) {
          jobNameByLang = {
            ...(jobNameByLang ?? {}),
            [m.lang]: lang === base
              ? jobNameCase(text, lang)
              : translatedJobNameCase(text, lang),
          };
          changed = true;
        }
      }
      if (m.summary) {
        const text = res.texts[k++];
        if (fresh.summary === quote.summary) {
          summaryByLang = { ...(summaryByLang ?? {}), [m.lang]: text };
          changed = true;
        }
      }
    }

    const stampLang = fresh.lang !== base;
    if (!changed && !stampLang) return fresh;
    return await this.quotes.update(fresh.id, input.userId, {
      ...(stampLang ? { lang: base } : {}),
      ...(descriptionByLang ? { descriptionByLang } : {}),
      ...(jobNameByLang ? { jobNameByLang } : {}),
      ...(summaryByLang ? { summaryByLang } : {}),
      lineItems,
    });
  }

  /** REQ-333: the language the quote's text was written in — the caller's
   *  word, else what an earlier run stored, else the contractor's app
   *  language (chat copy and job details are generated in it), else EN. */
  private async baseLang(
    quote: Quote,
    input: TranslateQuoteInput,
  ): Promise<QuoteLang> {
    if (input.baseLang) return input.baseLang;
    if (quote.lang === "es" || quote.lang === "en") return quote.lang;
    const me = await this.users?.get(input.userId).catch(() => null);
    return me?.language === "es" ? "es" : "en";
  }
}

/** One language's work: the description lines and line items it lacks
 *  (REQ-264) plus its job name and summary (REQ-400). */
type Batch = MissingTranslation & Omit<MissingHeading, "lang">;

/** REQ-400 (M5): merge what each language lacks into one batch per
 *  language, so one model call carries the lines and the heading. */
function batches(
  body: readonly MissingTranslation[],
  heading: readonly MissingHeading[],
): Batch[] {
  const out = new Map<string, Batch>();
  for (const m of body) out.set(m.lang, { ...m });
  for (const h of heading) {
    const b = out.get(h.lang) ??
      { lang: h.lang, descriptionLines: [], lineIndexes: [] };
    if (h.jobName) b.jobName = h.jobName;
    if (h.summary) b.summary = h.summary;
    out.set(h.lang, b);
  }
  return [...out.values()];
}
