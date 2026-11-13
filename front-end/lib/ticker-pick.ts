/**
 * REQ-319 (demo-loop cycle 1, m12) — which event the topbar's live-activity
 * pill shows. It used to rotate through the last ten notifications every
 * 3.8 s by array position, so a fresh "John Miller accepted · just now" was
 * followed by "Quote sent … 3m ago" — the pill read as going backwards. Now
 * the pill shows the newest event only (its age counts up), and the island
 * re-fetches the feed the moment a mutation goes through `lib/api.ts`
 * (`pm:mutated`) instead of waiting for the next 10 s poll.
 */
import {
  type LocalizableNotification,
  notificationTitle,
  type NotifTranslate,
} from "../../shared/quote-flow/notification-title.ts";

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

/**
 * REQ-726 (demo-loop cycle 5, m6) — how long the pill shows an event. It used
 * to show the newest event forever, so "Pago registrado … hace 4m" sat in the
 * bar on every page like a stuck toast, and caught clicks meant for the page.
 * The pill is now a transient notice: the newest event shows while it is
 * younger than this, then the pill goes away (the Activity panel keeps the
 * history). DashTopbar re-evaluates it on its 3.8 s age tick.
 */
export const TICKER_LIFETIME_MS = 90_000;

/** The newest event while it is younger than `TICKER_LIFETIME_MS`, else null.
 *  An older event never stands in for an expired newest one; a timestamp a
 *  little ahead of the browser's clock (skew) counts as fresh. */
export function freshTickerItem<T extends Stamped>(
  items: T[],
  nowMs = Date.now(),
): T | null {
  const newest = newestNotification(items);
  if (!newest) return null;
  const age = nowMs - new Date(newest.createdAt).getTime();
  return age < TICKER_LIFETIME_MS ? newest : null;
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

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * REQ-496 (demo-loop cycle 3, m36) — the pill's markup in the LIVE language.
 * A row with a `titleKey` is rendered here with `tr` (the island passes
 * `tFor(lang, …)`), so the EN/ES switch re-localizes it at once instead of
 * waiting for the profile PUT + a coalesced refetch; its words come from
 * params (a customer's name), so they are escaped before `innerHTML`. A legacy
 * row without a key keeps the server's trusted markup.
 */
export function tickerTitleHtml(
  item: LocalizableNotification,
  tr: NotifTranslate,
  lang?: "en" | "es",
): string {
  if (!item.titleKey) return item.title;
  // REQ-589 (cycle 4, m15): `lang` picks the job's name in that language.
  return notificationTitle(tr, item, lang).replace(
    /[&<>"']/g,
    (c) => HTML_ESCAPES[c],
  );
}
