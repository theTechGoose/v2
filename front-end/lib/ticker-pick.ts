/**
 * REQ-319 (demo-loop cycle 1, m12) — which event the topbar's live-activity
 * pill shows. It used to rotate through the last ten notifications every
 * 3.8 s by array position, so a fresh "John Miller accepted · just now" was
 * followed by "Quote sent … 3m ago" — the pill read as going backwards. Now
 * the pill shows the newest event only (its age counts up), and the island
 * re-fetches the feed the moment a mutation goes through `lib/api.ts`
 * (`pm:mutated`) instead of waiting for the next 10 s poll.
 */

/** Dispatched on `globalThis` after any successful non-GET through lib/api. */
export const MUTATION_EVENT = "pm:mutated";

export interface Stamped {
  id: string;
  createdAt: string;
}

/** The newest event by `createdAt` (ties keep feed order); null when empty or
 *  when no event carries a readable date. */
export function newestNotification<T extends Stamped>(items: T[]): T | null {
  let best: T | null = null;
  let bestAt = -Infinity;
  for (const item of items) {
    const t = new Date(item.createdAt).getTime();
    if (!Number.isFinite(t)) continue;
    if (t > bestAt) {
      best = item;
      bestAt = t;
    }
  }
  return best;
}

/** The event's words without markup, for the pill's hover title. */
export function tickerPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
