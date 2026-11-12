/**
 * REQ-343 — demo-loop cycle 1, issues p3 + p6: the assistant's example and
 * the terms wizard fit the business's trade.
 *
 * Onboarding asks no trade question (REQ-256 decision), so — like the sample
 * quote — the trade is read off the one thing the app knows: the business
 * name. Two pure reads, shared by the front-end (composer placeholder) and
 * the backend (which terms wizard a conversation gets):
 *
 *   - `tradeKindFor(name)`: "service" for the trades whose jobs are measured
 *     in hours and carry no workmanship warranty (cleaning, lawn care, junk
 *     removal / hauling …); "project" for everything else (the generic
 *     wizard: days/weeks, warranty asked).
 *   - `composerTradeFor(name)`: which `asstChat.composer.example.<trade>`
 *     line the composer shows instead of the one concrete-slab example.
 */
import { inferSampleTrade, type SampleTrade } from "./sample-quote.ts";

export type TradeKind = "service" | "project";

/** SampleTrade values whose jobs are service visits, not builds. */
const SERVICE_SAMPLE_TRADES: ReadonlySet<SampleTrade> = new Set<SampleTrade>([
  "cleaning",
  "landscaping",
  // REQ-360 gave the sample its own junk / moving / pest jobs — service
  // visits too (the stems below already said so).
  "junk",
  "moving",
  "pest",
]);

/** Lower-case stems (EN + ES) of service businesses the sample-quote trade
 *  list does not name. Junk removal is its own composer example. */
const JUNK_STEMS = [
  "junk",
  "haul",
  "trash",
  "debris",
  "dumpster",
  "basura",
  "escombro",
  "desecho",
  "chatarra",
] as const;
const OTHER_SERVICE_STEMS = [
  "pest",
  "exterminat",
  "fumig",
  "plaga",
  "mow",
  "snow",
  "window wash",
  "carpet",
  "mudanza",
  "moving",
  "mover",
] as const;

const hasStem = (name: string, stems: readonly string[]) =>
  stems.some((s) => name.includes(s));

/** "service" (hours, no warranty) or "project" (days/weeks, warranty). */
export function tradeKindFor(businessName?: string | null): TradeKind {
  const name = (businessName ?? "").toLowerCase();
  if (!name.trim()) return "project";
  if (SERVICE_SAMPLE_TRADES.has(inferSampleTrade(name))) return "service";
  if (hasStem(name, JUNK_STEMS) || hasStem(name, OTHER_SERVICE_STEMS)) {
    return "service";
  }
  return "project";
}

export const COMPOSER_TRADES = [
  "plumbing",
  "electrical",
  "roofing",
  "painting",
  "hvac",
  "cleaning",
  "landscaping",
  "junk",
  "general",
] as const;
export type ComposerTrade = (typeof COMPOSER_TRADES)[number];

/** The composer example a business name points at; "general" when none. */
export function composerTradeFor(businessName?: string | null): ComposerTrade {
  const name = (businessName ?? "").toLowerCase();
  if (!name.trim()) return "general";
  if (hasStem(name, JUNK_STEMS)) return "junk";
  // REQ-360's sample trades without a composer example of their own (moving,
  // pest, fencing, concrete, handyman) get the generic line.
  const trade: string = inferSampleTrade(name);
  return (COMPOSER_TRADES as readonly string[]).includes(trade)
    ? trade as ComposerTrade
    : "general";
}

/** The dictionary key of the composer placeholder for this business. The
 *  generic example keeps its historical key, `asstChat.composer.default`. */
export function composerPlaceholderKey(businessName?: string | null): string {
  const trade = composerTradeFor(businessName);
  return trade === "general"
    ? "asstChat.composer.default"
    : `asstChat.composer.example.${trade}`;
}
