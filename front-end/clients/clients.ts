/**
 * HTTP client for the /clients page.
 *
 * Backend references:
 *  - analytics/.../clients-controller/mod.ts
 *      GET /clients?page&pageSize&q&status → ClientsPageResponse (REQ-135 — one page)
 *      GET /analytics/clients/top       → TopClientsResponse
 */
import { api, type ApiOptions } from "../lib/api.ts";
import type { BalanceSubParts } from "../../shared/quote-flow/balance-sub.ts";
import type { CustomerPayload } from "../../shared/customer-form/mod.ts";

export type ClientStatus =
  | "active"
  | "lead"
  | "owes"
  | "regular"
  | "cold"
  | "new";
export type ClientLastTone = "hot" | "warm" | "cold";
/** REQ-367 — the card's jobs line as a kind; clients-display words it in the live language */
export type CustomerJobsSub = "overdue" | "active" | "scheduled" | "none";
export type ClientSegmentKey =
  | "property_mgmt"
  | "homeowner"
  | "small_biz"
  | "hoa"
  | "unsorted";

/** REQ-323 — the states `quoteState` / `invoiceState` name (shared/documents/versions.ts) */
export type CustomerDocState =
  | "draft"
  | "scheduled"
  | "sent"
  | "accepted"
  | "declined"
  | "revised"
  | "claimed"
  | "paid"
  | "void"
  | "approved"
  | "pending";

/** REQ-323 — one of the customer's documents as the card back lists it (mirrors the CRM DTO) */
export interface CustomerDocument {
  /** REQ-565 (demo m33): change orders are listed too */
  kind: "quote" | "invoice" | "change_order";
  id: string;
  number: string;
  state: CustomerDocState;
  /** a quote: the agreed total (quote + approved change orders); a change
   *  order: its signed delta */
  amountCents: number;
  /** REQ-565: a quote's approved change orders, summed — only when non-zero */
  changeOrdersCents?: number;
  /** `/quotes?open=<id>` for a quote, `/i/<id>` for an invoice, `/co/<id>` for a change order */
  url: string;
  updatedAt: string;
}

export interface CustomerCard {
  id: string;
  userId: string;
  name: string;
  /** REQ-198/323 — the customer's own number, "C-001" */
  number?: string;
  email?: string;
  phoneNumber?: string;
  address?: string;
  /** REQ-625: the address in parts; `address` is composed from them */
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  notes?: string;
  businessName?: string;
  /** REQ-715 (demo-loop cycle 5, m31): the language the customer reads —
   *  every send to them starts in it */
  language?: "en" | "es";
  segment?: Exclude<ClientSegmentKey, "unsorted">;
  vip?: boolean;
  createdAt: string;
  updatedAt: string;

  /** REQ-367: the timestamp — clients-display words "how long ago" in the live language */
  lastWhen: string | null;
  lastTone: ClientLastTone;
  balanceCents: number;
  /** The balance sub-line in English — the neutral base (REQ-204/350). */
  balanceSub: string;
  /** REQ-350 + REQ-367: the same line as data — clients-display words it in the live language */
  balanceSubParts?: BalanceSubParts;
  activeJobs: number;
  jobsSub: CustomerJobsSub;
  status: ClientStatus;
  temp: number;
  daysSinceContact: number;
  revenue12moCents: number;
  /** REQ-323 — every quote and invoice of the customer, newest first */
  documents: CustomerDocument[];
}

/** REQ-135 — the board's chips: a status, or all of them */
export type ClientsFilter = ClientStatus | "all";

/** REQ-135 — one page of the roster, with the chip counts over the query and the roster's totals */
export interface ClientsPageResponse {
  items: CustomerCard[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  counts: Record<ClientsFilter, number>;
  summary: {
    totalClients: number;
    activeJobs: number;
    owedCents: number;
    quietCount: number;
  };
  /** the three to call next: leads and owes, longest quiet first */
  loop: CustomerCard[];
}

export interface ClientsListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: ClientsFilter;
}

export interface TopClient {
  customerId: string;
  name: string;
  revenue12moCents: number;
  rank: number;
  barPct: number;
}

/** REQ-551: paid revenue (last 12 months) no customer card carries. */
export interface UnassignedRevenue {
  invoiceCount: number;
  revenue12moCents: number;
}

export interface TopClientsResponse {
  results: TopClient[];
  /** REQ-551: set when paid invoices with no customer are left unranked. */
  unassigned?: UnassignedRevenue;
}

export const clientsClient = {
  /** REQ-135 — one page; a blank query or the "all" chip is left off the URL */
  list: (params: ClientsListParams = {}, opts: ApiOptions = {}) =>
    api.get<ClientsPageResponse>("/clients", {
      ...opts,
      query: {
        page: params.page,
        pageSize: params.pageSize,
        q: params.q?.trim() || undefined,
        status: params.status && params.status !== "all"
          ? params.status
          : undefined,
      },
    }),
  top: (limit = 5, opts: ApiOptions = {}) =>
    api.get<TopClientsResponse>("/analytics/clients/top", {
      ...opts,
      query: { limit },
    }),
  /** REQ-626 — one customer (the client sheet opens by id, any page) */
  get: (id: string, opts: ApiOptions = {}) =>
    api.get<CustomerCard>(`/customers/${encodeURIComponent(id)}`, opts),
  /** REQ-625 — PUT /customers/:id (the edit form sends every field) */
  update: (id: string, patch: Record<string, unknown>, opts: ApiOptions = {}) =>
    api.put<CustomerCard>(`/customers/${encodeURIComponent(id)}`, patch, opts),
  /** REQ-802 — the card's Delete customer: REQ-039's soft delete (`deletedAt`), the row is kept */
  delete: (id: string, opts: ApiOptions = {}) =>
    api.delete<{ ok: true }>(`/customers/${id}`, opts),
  /** REQ-625 — the full customer form; REQ-283 the one-off task form's typed
   *  address; REQ-715 the customer's language (left out when not set) */
  create: (
    patch: CustomerPayload & { address?: string; language?: "en" | "es" },
    opts: ApiOptions = {},
  ) => api.post<CustomerCard>("/customers", patch, opts),
};
