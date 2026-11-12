import { Injectable } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import {
  missingQuoteTranslations,
  QUOTE_LANGS,
  type QuoteLang,
} from "#quote-flow/quote-translations.ts";

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
    const missing = missingQuoteTranslations(quote, langs, base);
    // The base slots still empty (a line added since the last run): `""` as
    // the base so the stored `lang` does not hide them from this check.
    const baseMissing = langs.includes(base)
      ? missingQuoteTranslations(quote, [base], "")
      : [];
    if (missing.length === 0 && baseMissing.length === 0 && quote.lang) {
      return quote;
    }

    const results = await Promise.all(missing.map(async (m) => {
      const lineTexts = m.lineIndexes.map((i) =>
        quote.lineItems[i].description.trim()
      );
      const texts = [...m.descriptionLines, ...lineTexts];
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
      const lineTexts = m.lineIndexes.map((i) =>
        quote.lineItems[i].description.trim()
      );
      const texts = [...m.descriptionLines, ...lineTexts];
      results.push({ m, res: { texts, translated: true }, texts });
    }

    // Re-read so a concurrent edit (another field) isn't clobbered; merge
    // only into the slots this run translated, and only if their base text
    // is unchanged.
    const fresh = await this.quotes.getOwned(input.quoteId, input.userId);
    let descriptionByLang = fresh.descriptionByLang;
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
    }

    const stampLang = fresh.lang !== base;
    if (!changed && !stampLang) return fresh;
    return await this.quotes.update(fresh.id, input.userId, {
      ...(stampLang ? { lang: base } : {}),
      ...(descriptionByLang ? { descriptionByLang } : {}),
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
