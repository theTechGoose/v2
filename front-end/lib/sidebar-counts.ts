/**
 * REQ-518 (demo-loop cycle 3, issue p8-pair6-c) — the sidebar's pink count pill is a call to act,
 * so it only counts work that is waiting on someone: quotes sent and awaiting the customer's reply,
 * invoices sent and not yet paid. Running totals (how many customers the account has) are never a
 * count — one customer used to show a red "1" on Customers that read as an unread alert.
 * A zero is omitted, and every pill is labelled (`countLabelKey`) for its title / aria-label.
 */
import type { DashboardStats } from "../clients/dashboard.ts";
import { followChanges, isDocChange } from "./change-feed.ts";

export type CountKey = "quotes" | "invoices";

export function pickSidebarCounts(
  stats: DashboardStats,
): Partial<Record<CountKey, number>> {
  const counts: Partial<Record<CountKey, number>> = {};
  if (stats.quotes.sent > 0) counts.quotes = stats.quotes.sent;
  if (stats.invoices.pending > 0) counts.invoices = stats.invoices.pending;
  return counts;
}

/** The i18n key that says what a pill counts — "{count}" is interpolated. */
export function countLabelKey(countKey: string): string {
  return `nav.count.${countKey}`;
}

/** REQ-698 (demo-loop cycle 5, m14): the counts move when a quote or an
 *  invoice does — re-read them (`refreshDash`) on every document change the
 *  change feed hears. The badge said "Cotizaciones 1" on /quotes after the
 *  customer signed in another tab: the page re-read its own list, but the
 *  sidebar kept its mount snapshot. Returns stop(). */
export function followBadgeChanges(refresh: () => unknown): () => void {
  return followChanges(isDocChange, refresh);
}
