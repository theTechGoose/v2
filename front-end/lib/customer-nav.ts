/**
 * REQ-924 — the sidebar's Customers context: on /customers and /customers/<id> the sidebar rests on a
 * list of the customers instead of the root (Back returns to it). Pure: which pages rest there, the
 * open customer, and the rows — most overdue first, then most owed, then by name — with the kind of
 * status line each shows ("$X overdue", "Owes $X", the repeat visit's schedule, else the board's REQ-990 zero-balance word). The
 * island words the line in the live language.
 */

import type { CustomerCard } from "../clients/clients.ts";
import { hasBilled } from "./clients-display.ts";

/** the sidebar path that means "the Customers context" (not a folder of NAV) */
export const CUSTOMERS_CONTEXT = "@customers";

/** /customers rests as "customers"; a customer's page as "customer:<id>" */
export function isCustomersPage(active: string | undefined): boolean {
  return active === "customers" || (active?.startsWith("customer:") ?? false);
}

export function activeCustomerId(active: string | undefined): string | null {
  return active?.startsWith("customer:")
    ? active.slice("customer:".length) || null
    : null;
}

export type CustomerNavTone = "late" | "owes" | "rec" | "paid";

export interface CustomerNavRow {
  id: string;
  name: string;
  initials: string;
  href: string;
  tone: CustomerNavTone;
  /** late: the overdue part; owes: the balance; else 0 */
  amountCents: number;
  /** rec: the active repeat visit's schedule */
  schedule?: { en: string; es: string };
  /** REQ-990: an issued, non-void invoice exists (REQ-323 `hasBilled`) — "paid" words it
   *  "Settled" when true, "Nothing billed yet" when not (`zeroBalanceKey`) */
  billed?: boolean;
}

export interface NavCard {
  id: string;
  name: string;
  balanceCents: number;
  overdueCents?: number;
  /** the card's documents — only `hasBilled` reads them (REQ-990) */
  documents?: CustomerCard["documents"];
}
export interface NavSub {
  active: boolean;
  schedule: { en: string; es: string };
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "•";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const RANK: Record<CustomerNavTone, number> = {
  late: 0,
  owes: 1,
  rec: 2,
  paid: 2,
};

export function customerNavRows(
  cards: readonly NavCard[],
  subsByCustomer: ReadonlyMap<string, readonly NavSub[]> = new Map(),
): CustomerNavRow[] {
  return cards
    .map((c): CustomerNavRow => {
      const overdue = Math.max(0, c.overdueCents ?? 0);
      const owed = Math.max(0, c.balanceCents);
      const live = (subsByCustomer.get(c.id) ?? []).find((s) => s.active);
      const base = {
        id: c.id,
        name: c.name,
        initials: initialsOf(c.name),
        href: `/customers/${encodeURIComponent(c.id)}`,
      };
      if (overdue > 0) return { ...base, tone: "late", amountCents: overdue };
      if (owed > 0) return { ...base, tone: "owes", amountCents: owed };
      if (live) {
        return {
          ...base,
          tone: "rec",
          amountCents: 0,
          schedule: live.schedule,
        };
      }
      return { ...base, tone: "paid", amountCents: 0, billed: hasBilled(c) };
    })
    .sort((a, b) =>
      RANK[a.tone] - RANK[b.tone] ||
      b.amountCents - a.amountCents ||
      a.name.localeCompare(b.name)
    );
}

/** whole dollars under $1,000, else thousands with one decimal: $980, $4.5k, $12k */
export function shortMoney(cents: number): string {
  const d = Math.round(Math.max(0, cents) / 100);
  if (d < 1000) return `$${d}`;
  const k = d / 1000;
  const s = k >= 10 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, "");
  return `$${s}k`;
}
