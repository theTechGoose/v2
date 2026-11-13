import { Injectable } from "#danet/core";
import { isSampleQuote } from "#quote-flow/pipeline-stats.ts";
import {
  inferSampleTrade,
  SAMPLE_PRICES,
  sampleQuoteKeys,
} from "#quote-flow/sample-quote.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { t } from "@core/i18n/mod.ts";

export interface EnsureSampleQuoteInput {
  userId: string;
  /** The contractor's language — the single-language fields (jobName,
   *  summary, description, line-item text) are written in it. Both languages
   *  are always stored per-language as well (REQ-256). Defaults to "en". */
  language?: "en" | "es";
}
export interface EnsureSampleQuoteResult {
  quoteId: string;
  created: boolean;
}

const LANGS = ["en", "es"] as const;
const byLang = (key: string) =>
  Object.fromEntries(LANGS.map((l) => [l, t(l, key)])) as Record<
    string,
    string
  >;

/**
 * EnsureSampleQuote — per-user idempotent "see what your customer sees"
 * quote, made when the onboarding wizard reaches its sample step, so the link
 * is branded with the user's own businessName / contact info.
 *
 * REQ-256 (demo issue onboarding-dashboard-settings-p2):
 *   - the job fits the business — its trade is read off the business name
 *     (shared/quote-flow/sample-quote.ts), a general home-repair job when the
 *     name names none — instead of a paver patio for everyone;
 *   - the content is stored in English AND Spanish (jobNameByLang,
 *     summaryByLang, descriptionByLang, each line item's descriptionByLang),
 *     so the public page's EN | ES toggle flips the content, not only the
 *     chrome;
 *   - it is a DRAFT nobody was sent, and it takes no Q- number (the first
 *     real quote is Q-001); the public page shows it as a sample addressed to
 *     a placeholder customer ("Your customer"), never "TO —".
 *
 * The quote is stamped `isSample: true` (P-15) so pipeline/money/open
 * aggregates skip it while the card stays visible and badged. Subsequent
 * calls find the same row (flag, or the legacy "onboarding-sample-v1"
 * summary prefix) and skip creation.
 */
@Injectable()
export class EnsureSampleQuote {
  constructor(
    private quotes: QuoteStore,
    private identity: BusinessIdentityStore,
  ) {}

  async run(input: EnsureSampleQuoteInput): Promise<EnsureSampleQuoteResult> {
    const lang = input.language ?? "en";
    const existing = await this.quotes.listByUser(input.userId);
    const found = existing.find((q) => isSampleQuote(q));
    if (found) return { quoteId: found.id, created: false };

    const identity = await this.identity.get(input.userId).catch(() => null);
    const trade = inferSampleTrade(identity?.businessName);
    const keys = sampleQuoteKeys(trade);
    const [materialsCents, laborCents] = SAMPLE_PRICES[trade];
    const jobNameByLang = byLang(keys.jobName);
    const descriptionByLang = byLang("ensureSampleQuote.description");
    const materials = byLang(keys.materials);
    const labor = byLang(keys.labor);

    const quote = await this.quotes.create(input.userId, {
      // Clean, human summary — the internal sample tag lives in the
      // dedicated isSample flag, never in rendered copy (P-15).
      summary: jobNameByLang[lang],
      summaryByLang: jobNameByLang,
      jobName: jobNameByLang[lang],
      jobNameByLang,
      isSample: true,
      description: descriptionByLang[lang],
      descriptionByLang,
      lineItems: [
        {
          description: materials[lang],
          descriptionByLang: materials,
          quantity: 1,
          unit: "ea",
          price: materialsCents,
        },
        {
          description: labor[lang],
          descriptionByLang: labor,
          quantity: 1,
          unit: "ea",
          price: laborCents,
        },
      ],
      estimatedTotal: materialsCents + laborCents,
      status: "draft",
      // REQ-256 (supersedes REQ-241's "SAMPLE" mark): the sample takes no
      // number at all — the owner's first real quote is Q-001.
    }, { unnumbered: true, jobNameLang: lang });
    return { quoteId: quote.id, created: true };
  }
}
