/**
 * REQ-497 (demo-loop cycle 3, m23): the dashboard's job and quote rows title
 * a document in the language the app shows — the same rule as /quotes
 * (REQ-394 quoteJobTitle: jobNameByLang[lang] → jobName → summaryByLang[lang]
 * → summary). The rows used to render the primary summary, so an English
 * quote stayed English on the Spanish dashboard.
 */
import { quoteJobTitle } from "../../shared/quote-flow/job-name.ts";
import type { Job } from "../clients/dashboard.ts";
import type { QuoteCard } from "../clients/quotes.ts";
import type { Lang } from "./i18n.ts";

/** The Active jobs row's task line. */
export function jobRowTitle(j: Job, lang: Lang): string {
  return quoteJobTitle(j.quote, lang) ?? "";
}

/** The Quotes awaiting row's description line. */
export function quoteRowTitle(q: QuoteCard, lang: Lang): string {
  return quoteJobTitle(q, lang) ?? "";
}
