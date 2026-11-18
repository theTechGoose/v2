/**
 * REQ-924 — the top-bar search, context-aware. In the Customers context the search carries a
 * "Customers" scope: the open customer's results come first, in one group ("In <name>"), then the
 * rest by type (REQ-207's order); a customer result opens her page (`/customers/<id>`). Without a
 * scope nothing changes. Pure.
 */
import {
  groupHits,
  type SearchHit,
  type SearchType,
} from "../../shared/documents/search.ts";

/** the open customer, when the page is one */
export interface SearchScope {
  customerId?: string;
  customerName?: string;
}

export interface ScopedGroup {
  /** "mine" for the open customer's group, else the type */
  key: "mine" | SearchType;
  hits: SearchHit[];
}

const isHers = (h: SearchHit, id: string) =>
  h.customerId === id || (h.type === "customer" && h.id === id);

export function scopeGroups(
  hits: readonly SearchHit[],
  scope: SearchScope | null,
): ScopedGroup[] {
  const id = scope?.customerId;
  const rest = id ? hits.filter((h) => !isHers(h, id)) : [...hits];
  const typed: ScopedGroup[] = groupHits(rest).map((g) => ({
    key: g.type,
    hits: g.hits,
  }));
  if (!id) return typed;
  const mine = groupHits(hits.filter((h) => isHers(h, id))).flatMap((g) =>
    g.hits
  );
  return mine.length ? [{ key: "mine", hits: mine }, ...typed] : typed;
}

/** where a result goes: in the Customers context, a customer opens her page */
export function scopedUrl(h: SearchHit, scope: SearchScope | null): string {
  if (scope && h.type === "customer") {
    return `/customers/${encodeURIComponent(h.id)}`;
  }
  return h.url;
}
