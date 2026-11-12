/**
 * REQ-135 — the one set of rules a customers page is cut by. Raphael, 2026-11-03: "we need to
 * paginate this information via the api cause customers take a long time to load now and its
 * affecting other pages too."
 *
 * Pure: the whole roster of cards in, one page out — the query, the status chip, the order, the
 * page, the chip counts (over what the query matched) and the roster's totals and loop picks
 * (over everything). The page draws what it is handed and derives nothing.
 */
import type { Customer, CustomerCard, CustomerStatus } from "@crm/dto/customer.ts";

export const CLIENTS_PAGE_SIZE = 25;
export const CLIENTS_PAGE_SIZE_MAX = 100;

export type ClientsFilter = CustomerStatus | "all";
export const CLIENTS_FILTERS: readonly ClientsFilter[] = ["all", "new", "active", "lead", "owes", "regular", "cold"];

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type ClientsCounts = Record<ClientsFilter, number>;

export interface ClientsSummary {
  totalClients: number;
  activeJobs: number;
  owedCents: number;
  quietCount: number;
}

export interface ClientsPageResponse extends Page<CustomerCard> {
  counts: ClientsCounts;
  summary: ClientsSummary;
  /** the three to call next: leads and owes, longest quiet first */
  loop: CustomerCard[];
}

export interface ClientsPageQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: ClientsFilter | string;
}

type Searchable = Pick<Customer, "name" | "businessName" | "email" | "phoneNumber" | "address" | "notes">;

/** a blank query matches all; otherwise name, business, email, phone (by digits), address or notes, case-insensitive */
export function matchesQuery(c: Searchable, q: string | undefined): boolean {
  const needle = (q ?? "").trim().toLowerCase();
  if (!needle) return true;
  const digits = needle.replace(/\D/g, "");
  const texts = [c.name, c.businessName, c.email, c.address, c.notes];
  if (texts.some((t) => (t ?? "").toLowerCase().includes(needle))) return true;
  if (digits.length >= 3 && (c.phoneNumber ?? "").replace(/\D/g, "").includes(digits)) return true;
  return false;
}

/** by name, case-insensitive, then by createdAt — a stable order for paging */
export function sortByName<T extends Pick<Customer, "name" | "createdAt">>(items: readonly T[]): T[] {
  return [...items].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.createdAt.localeCompare(b.createdAt)
  );
}

export function pageOf<T>(items: readonly T[], page: number | undefined, pageSize: number | undefined): Page<T> {
  const size = Math.max(1, Math.min(CLIENTS_PAGE_SIZE_MAX, Math.floor(Number(pageSize) || CLIENTS_PAGE_SIZE)));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const p = Math.max(1, Math.min(totalPages, Math.floor(Number(page) || 1)));
  return { items: items.slice((p - 1) * size, p * size), page: p, pageSize: size, total, totalPages };
}

export function countByStatus(cards: readonly CustomerCard[]): ClientsCounts {
  const counts: ClientsCounts = { all: cards.length, new: 0, active: 0, lead: 0, owes: 0, regular: 0, cold: 0 };
  for (const c of cards) counts[c.status]++;
  return counts;
}

export function summarize(cards: readonly CustomerCard[]): ClientsSummary {
  return {
    totalClients: cards.length,
    activeJobs: cards.filter((c) => c.status === "active").length,
    owedCents: cards.reduce((sum, c) => sum + (c.balanceCents > 0 ? c.balanceCents : 0), 0),
    quietCount: cards.filter((c) => c.status === "cold").length,
  };
}

export function loopPicks(cards: readonly CustomerCard[]): CustomerCard[] {
  return cards.filter((c) => c.status === "lead" || c.status === "owes")
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact)
    .slice(0, 3);
}

export function isClientsFilter(s: unknown): s is ClientsFilter {
  return typeof s === "string" && (CLIENTS_FILTERS as readonly string[]).includes(s);
}

export function clientsPage(cards: readonly CustomerCard[], query: ClientsPageQuery = {}): ClientsPageResponse {
  const status: ClientsFilter = isClientsFilter(query.status) ? query.status : "all";
  const matched = cards.filter((c) => matchesQuery(c, query.q));
  const cut = status === "all" ? matched : matched.filter((c) => c.status === status);
  return {
    ...pageOf(sortByName(cut), query.page, query.pageSize),
    counts: countByStatus(matched),
    summary: summarize(cards),
    loop: loopPicks(cards),
  };
}
