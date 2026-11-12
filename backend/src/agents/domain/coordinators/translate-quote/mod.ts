import { Injectable } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import {
  missingQuoteTranslations,
  QUOTE_LANGS,
} from "#quote-flow/quote-translations.ts";

export interface TranslateQuoteInput {
  userId: string;
  quoteId: string;
  /** Languages to fill; defaults to every document language (en, es). */
  langs?: readonly ("en" | "es")[];
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
 */
@Injectable()
export class TranslateQuote {
  constructor(
    private quotes: QuoteStore,
    private translator: TranslateBullets,
  ) {}

  async run(input: TranslateQuoteInput): Promise<Quote> {
    const quote = await this.quotes.getOwned(input.quoteId, input.userId);
    const missing = missingQuoteTranslations(
      quote,
      input.langs ?? QUOTE_LANGS,
    );
    if (missing.length === 0) return quote;

    const results = await Promise.all(missing.map(async (m) => {
      const lineTexts = m.lineIndexes.map((i) =>
        quote.lineItems[i].description.trim()
      );
      const texts = [...m.descriptionLines, ...lineTexts];
      const res = await this.translator.run({
        userId: input.userId,
        texts,
        to: m.lang as "en" | "es",
      });
      return { m, res, texts };
    }));

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

    if (!changed) return fresh;
    return await this.quotes.update(fresh.id, input.userId, {
      ...(descriptionByLang ? { descriptionByLang } : {}),
      lineItems,
    });
  }
}
