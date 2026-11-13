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

/**
 * REQ-743 (demo-loop cycle 5, p18-6c): the customer card's "Repeat visits"
 * panel shows when the customer has any, or when the business is a service
 * trade (cleaning, lawn care …) that books them; a handyman's customer with
 * none gets no empty panel.
 */
export function repeatVisitsPanelShown(
  subscriptionCount: number,
  tradeKind: TradeKind,
): boolean {
  return subscriptionCount > 0 || tradeKind === "service";
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
  // REQ-450 (demo-loop cycle 3, p4): the trades that used to fall back to
  // the generic slab line get their own examples.
  "moving",
  "pest",
  "fencing",
  "concrete",
  "handyman",
  "kitchenbath",
  "general",
] as const;
export type ComposerTrade = (typeof COMPOSER_TRADES)[number];

/** REQ-450: kitchen & bath / remodel names (EN + ES). Read only when the
 *  sample-quote trade list names nothing, so "Kitchen & Bath Plumbing"
 *  stays a plumber. */
const KITCHEN_BATH_STEMS = [
  "kitchen",
  "bath",
  "remodel",
  "cabinet",
  "countertop",
  "tile",
  "cocina",
  "baño",
  "bano",
  "remodela",
  "gabinete",
  "azulej",
] as const;

/** The composer example a business name points at; "general" when none. */
export function composerTradeFor(businessName?: string | null): ComposerTrade {
  const name = (businessName ?? "").toLowerCase();
  if (!name.trim()) return "general";
  if (hasStem(name, JUNK_STEMS)) return "junk";
  const trade: string = inferSampleTrade(name);
  if (trade === "general" && hasStem(name, KITCHEN_BATH_STEMS)) {
    return "kitchenbath";
  }
  return (COMPOSER_TRADES as readonly string[]).includes(trade)
    ? trade as ComposerTrade
    : "general";
}

/**
 * REQ-450: which flow the composer is in. "priced" — the contractor names
 * the price ("I know my price", "Just give me a quick quote", "Job done,
 * need to invoice"): the example shows a job WITH a price. "ask" — "help me
 * price it" or free chat: the example asks what to charge.
 */
export type ComposerFlow = "ask" | "priced";
export function composerFlowFor(chip?: string | null): ComposerFlow {
  return chip === "knownPrice" || chip === "quickQuote" ||
      chip === "invoiceDone"
    ? "priced"
    : "ask";
}

/** The dictionary key of the composer placeholder for this business and
 *  flow. The generic "ask" example keeps its historical key,
 *  `asstChat.composer.default`. */
export function composerPlaceholderKey(
  businessName?: string | null,
  flow: ComposerFlow = "ask",
): string {
  const trade = composerTradeFor(businessName);
  if (flow === "priced") return `asstChat.composer.priced.${trade}`;
  return trade === "general"
    ? "asstChat.composer.default"
    : `asstChat.composer.example.${trade}`;
}

/** REQ-450: the New-invoice job-name placeholder for this business — the
 *  same trade read as the composer; the generic key when none. */
export function invoiceJobNamePlaceholderKey(
  businessName?: string | null,
): string {
  const trade = composerTradeFor(businessName);
  return trade === "general"
    ? "invoicesPage.new.jobNamePlaceholder"
    : `invoicesPage.new.jobNamePlaceholder.${trade}`;
}

/** REQ-581 (demo-loop cycle 4, p3): the hint under the composer while
 *  Edit's "Change the quote: " seed sits there — a change of the business's
 *  own trade (never "tile $3,600" for a fence company); the trade-free
 *  generic key when the name names no trade. */
export function editHintKey(businessName?: string | null): string {
  const trade = composerTradeFor(businessName);
  return trade === "general"
    ? "asstChat.actionCard.editHint"
    : `asstChat.actionCard.editHint.${trade}`;
}
