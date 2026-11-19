/**
 * REQ-924 — the sidebar's Customers context: on /customers and /customers/<id> the sidebar rests on a
 * list of the customers instead of the root (Back returns to it). Pure: which pages rest there, the
 * open customer, and the rows — most overdue first, then most owed, then by name — with the kind of
 * status line each shows ("$X overdue", "Owes $X", the repeat visit's schedule, else the board's REQ-990 zero-balance word). The
 * island words the line in the live language.
 */

import type { CustomerCard } from "../clients/clients.ts";
import { hasBilled } from "./clients-display.ts";
import { fmtMoneyTotal } from "./format.ts";

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

/**
 * REQ-1041 (amends REQ-924(a)) — the row's amount is her exact balance, the same figure the Balance
 * KPI shows: "$1,750", "$12,400", "$1,750.25" (cents dropped only when they are .00). It used to be a
 * compact "$1.8k" that rounded the debt UP; the row's ellipsis CSS handles anything long.
 */
export function shortMoney(cents: number): string {
  return fmtMoneyTotal(Math.max(0, cents));
}

/**
 * REQ-993 — Send invoice re-reads the customer list; "open" the new-invoice form with her chosen
 * when she is still in it, "missing" when she was deleted (e.g. in another tab), so the page shows
 * "Customer not found" instead of a blank form.
 */
export function invoiceFormTarget(
  customers: readonly { id: string }[],
  customerId: string,
): "open" | "missing" {
  return customers.some((x) => x.id === customerId) ? "open" : "missing";
}
